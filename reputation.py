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
SEC_HEADERS = {"User-Agent": os.getenv("SEC_USER_AGENT", "")} # gets the SEC EDWARD environment variable API key stored in the os
TIMEOUT = 30

## Now the two lookup functions:

def find_company(ticker):
    rows = requests.get("https://www.sec.gov/files/company_tickers.json", 
                        headers=SEC_HEADERS,
                        timeout=TIMEOUT).json()
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
                        timeout=TIMEOUT).json()
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
                             "h1": "en-US", 
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

# STEP 4: HAVE CLAUDE SUMMARIZE (OPTIONAL; MAYBE CAN USE A FREE LLM)

def summarize(company, legal, news):
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    import anthropic
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

    msg = anthropic.ANTHROPIC().message.create(
        model="claude-sonnet-5-5",
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = msg.content[0].text.strip().removeprefix("'''json").removesuffix("'''")
    return json.loads(raw)

# STEP 5: WRITE THE JSON AND WIRE IT ALL TOGETHER

## This step packs everything into the same shape as Saksham's metrics JSON and add `get_reputation(ticker)`, the function the backend calls

def build(tenk, legal, news, summary):
    summary = summary or {}
    tags = summary.get("tags", {})
    headlines_out = [{"date": n["date"],
                      "tag": tags.get(f"news={i + 1}", "-"),
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
    text = summary.get("summary") or "Not summarized: no ANTHROPIC_API_KEY set."
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