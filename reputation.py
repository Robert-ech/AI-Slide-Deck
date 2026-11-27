import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date
from email.utils import parsedate_to_datetime
from pathlib import Path
import requests
from bs4 import BeautifulSoup


try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

# STEP 1: FIND THE COMPANY AND ITS LATEST 10K filing

## Constants (unchanging variables through the entirety of the program's execution)
SEC_HEADERS = {"User-Agent": os.getenv("SEC_USER_AGENT", "")} # gets the SEC Edgar environment variable API key stored locally in the .env file in the os 
TIMEOUT = 30

## Now the two lookup functions:

def find_company(ticker):
    rows = requests.get("https://www.sec.gov/files/company_tickers.json", 
                        headers=SEC_HEADERS,
                        timeout=TIMEOUT)
    rows.raise_for_status()
    rows = rows.json()
    for row in rows.values():
        if row['ticker'].upper() == ticker:
            return {
                "name": row['title'], 
                "ticker": ticker,
                "cik": str(row["cik_str"]).zfill(10)
            }
    sys.exit(f"Ticker {ticker} not found on EDGAR")

def latest_10K(cik):
    subs = requests.get(f"https://data.sec.gov/submissions/CIK{cik}.json",
                        headers=SEC_HEADERS,
                        timeout=TIMEOUT)
    subs.raise_for_status()
    subs = subs.json()
    recent = subs["filings"]["recent"]
    for i, form in enumerate(recent["form"]):
        if form == "10-K":
            acc = recent["accessionNumber"][i]
            url = (f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"f"{acc.replace('-','')}/{recent['primaryDocument'][i]}")
            return {"accession": acc,
                    "filed": recent["filingDate"][i],
                    "url": url}
    sys.exit("No 10-k found")


# STEP 2: PULL OUT ITEM 3, LEGAL PROCEEDINGS

def item3_text(url):
    html = requests.get(url, headers=SEC_HEADERS, timeout=TIMEOUT).text
    text = BeautifulSoup(html, "html.parser").get_text("")
    text = re.sub(r"\s+", " ", text.replace("\xa0", " "))
    best = ""

    for start in re.finditer(r"item\s*3\s*[.:\-]?\s*legal\s+proceedings", text, re.I):
        end = re.search(r"item\s*4\s*[.:\-]?\s*mine\s+safety", text[start.end():], re.I)
        chunk = text[start.start(): start.end() + (end.start() if end else 4000)]
        if len(chunk) > len(best):  # the table of contents match is the short one
            best = chunk
    return best[:4000].strip()


# STEP 3: GRAB RECENT HEADLINES FROM GOOGLE NEWS

def headlines(name, limit=10):
    query = f'"{name}" when:90d'
    r = requests.get("https://news.google.com/rss/search", 
                     params={"q": query, 
                             "hl": "en-US", 
                             "gl": "US", 
                             "ceid": "US:en"},
                     timeout=TIMEOUT)
    root = ET.fromstring(r.content)
    seen, out = set(), []
    for item in root.iter("item"):
        title = item.findtext("title", "")
        outlet = item.findtext("source", "")
        if outlet and title.endswith(" - " + outlet):
            title = title[: -len(" - " + outlet)]
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        published = parsedate_to_datetime(item.findtext("pubDate")).date().isoformat()
        out.append({"title": title, 
                    "url": item.findtext("link", ""),
                    "outlet": outlet,
                    "date": published})
        if len(out) == limit:
            break
    return out

# STEP 4: HAVE LLM SUMMARIZE (provider of the specific LLM set in .env)
SYSTEM = ("You are a careful assistant to a bank credit analyst. ""Use only the sources you are given. Reply with JSON only.")

def summarize(company, legal, news):
    key = os.getenv("LLM_API_KEY")
    if not key:
        return None
    from openai import OpenAI
    client = OpenAI(api_key=key,
                    base_url = os.getenv("LLM_BASE_URL") or None,
                    timeout=60,
                    max_retries=2)
    lines = "\n".join(f'[news-{i + 1}] {n["date"]} {n["outlet"]}: {n["title"]}' for i, n in enumerate(news))
    prompt = f"""You are helping a bank credit analyst judge {company['name']}'s reputation.
        Use only the text below. [10k] is Item 3 Legal Proceedings from the latest 10-K.

        [10k] {legal or 'No Item 3 text found.'}

        {lines}

        Reply with JSON only, no other text:
        {{"level": "Low" | "Medium" | "High",
        "summary": "one or two sentences, under 40 words",
        "tags": {{"news-1": "Legal" | "Regulatory" | "Fraud" | "Distress" | "Cyber/Safety" | "-", ...}}}}
        Tag every headline. "-" means it is not a risk to this company
        (for example, the company suing someone else is "-").
        Low = nothing material; Medium = notable but not material;
        High = material litigation, enforcement, fraud, or distress."""

    try:
        resp = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gemini-3.5-flash-lite"),
            messages=[
                {
                "role": "system", "content": SYSTEM},
                {
                "role": "user", "content": prompt
                }],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
            reasoning_effort="low"
        )
        result = json.loads(resp.choices[0].message.content)
    except Exception as e:
        print(f"LLM summary skipped: {type(e).__name__}: {e}", file=sys.stderr)
        return None

    # Don't trust the shape blindly: check the one field the flag depends on
    if result.get("level") not in ("Low", "Medium", "High"):
        print(f"LLM gave an unexpected level: {result.get('level')!r}",
              file=sys.stderr)
        result["level"] = None

    return result

# STEP 5: WRITE THE JSON AND WIRE IT ALL TOGETHER

## This step packs everything into the same shape as Saksham's metrics JSON and add `get_reputation(ticker)`, the function the backend calls

def build(tenk, legal, news, summary):
    summary = summary or {}
    tags = summary.get("tags", {})
    headlines_out = [{"date": n["date"],
                      "tag": tags.get(f"news-{i + 1}", "-"),
                      "title": n["title"],
                      "url": n["url"]} for i, n in enumerate(news)]
    flag = {
        "unit": "label", 
        "period": "90d", 
        "value": summary.get("level"),
        "sources": [{"name": "EDGAR", "type": "direct"}, 
                    {"name": "Google News", "type": "derived"}],
        "spread_pct": None, 
        "link": tenk["url"]
    }
    text = summary.get("summary") or "Not summarized: no LLM_API_KEY set."
    return {
        "reputation_flag": flag,
        "headlines": headlines_out,
        "reputation_summary": {
            "text": text,
            "legal_excerpt": legal,
            "as_of": date.today().isoformat()
        }
    }

## the one function the backend calls; return the reputation dictionary object

def get_reputation(ticker):
    company = find_company(ticker.upper())
    tenk = latest_10K(company["cik"])
    legal = item3_text(tenk['url'])
    name = re.sub(r"[,\s]+(inc\.?|corp\.?|corporation|co\.?|ltd\.?|plc)\b.*$", "", company["name"], flags=re.I)
    news = headlines(name)
    summary = summarize(company, legal, news)

    return build(tenk, legal, news, summary)


 # manual test that only runs if reputations.py file is executed directly, as a manual test; so this block doesn't run when this file is called from a website query
if __name__ == "__main__":
    # only: python reputation.py WMT
    ticker = (sys.argv[1] if len(sys.argv) > 1 else "WMT").upper()
    out = get_reputation(ticker)
    print("Flag:", out["reputation_flag"]["value"])
    print("Summary:", out["reputation_summary"]["text"])
    for h in out["headlines"]:
        print(" ", h["date"], h["tag"], "|", h["title"])
    Path("data").mkdir(exist_ok=True)
    path = Path("data") / f'{ticker}_reputation.json'
    path.write_text(json.dumps(out, indent=2))
    print("Wrote", path)