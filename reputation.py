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

