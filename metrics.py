"""
Source check + metrics table for the AI Pitch Deck memo.
Pulls every metric in the proposal from every source that can supply it and prints
one table: Metric | Source | Value | Note (note = how it was derived / filing citation).

Usage:  python source_check.py [TICKER] [ttm|fy] [--json] [--out PATH]
  --json  also write the memo JSON (shape of sample_output.json) to output_<TICKER>.json
  --out   write the JSON to PATH instead (implies --json)
Keys go in a .env file next to this script (copy .env.example); real env vars also work.
A missing key just skips that source:
  SEC_USER_AGENT  e.g. "Your Name your@email.com"   (EDGAR requires it)
  FMP_API_KEY, FINNHUB_API_KEY, NEWSAPI_KEY, FRED_API_KEY
Install: pip install -r requirements.txt
"""
import argparse
import json
import math
import os
import re
import statistics
import sys
import time
from collections import OrderedDict
from datetime import date, timedelta

import requests
from pathlib import Path

try:  # keys live in a .env file next to this script (see .env.example)
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

_ap = argparse.ArgumentParser(description="Collect metrics from every source; print a table; optionally write the memo JSON")
_ap.add_argument("ticker", nargs="?", default="AAPL")
_ap.add_argument("period", nargs="?", default="ttm", type=str.lower, choices=["ttm", "fy"],
                 help="period used by the printed table (the JSON always has 3 fiscal years + most current)")
_ap.add_argument("--json", action="store_true", help="write output_<TICKER>.json")
_ap.add_argument("--out", metavar="PATH", help="JSON output path (implies --json)")
ARGS = _ap.parse_args()
TICKER, PERIOD = ARGS.ticker.upper(), ARGS.period
TIMEOUT = 20
FCCR_THRESHOLD = 1.25

# --------------------------------------------------------------------------- layout
# Every metric named in the proposal. All of them print, even if no source returned data.
LAYOUT = OrderedDict([
    ("EBITDA", ["EBITDA", "EBITDA margin"]),
    ("Growth (valuation)", ["3-yr revenue growth (CAGR)", "Market cap", "EV/EBITDA"]),
    ("Revenue QoQ, YoY", ["Revenue (latest quarter)", "Revenue QoQ", "Revenue YoY"]),
    ("Profit margins", ["Gross margin", "Operating margin", "Net margin"]),
    ("Liquidity", ["Current ratio", "Quick ratio", "Cash on hand"]),
    ("Fixed charge coverage ratio", ["Fixed charge coverage ratio"]),
    ("Leverage ratio", ["Net debt / EBITDA", "Net debt / EBITDA trend"]),
    ("Debt", ["Total debt", "Net debt", "Average interest rate", "Floating-rate share",
              "Debt maturity schedule"]),
    ("Reputation", ["Reputation flag"]),
    ("Company exposure", ["Customer concentration", "Seasonality (peak quarter share)",
                          "Revenue by segment", "Revenue by region"]),
    ("Market stability", ["Beta", "Annualized volatility", "Max drawdown (1y)", "VIX",
                          "High-yield spread", "10Y-2Y yield curve"]),
])
METRIC_SECTION = {m: s for s, ms in LAYOUT.items() for m in ms}
ROWS = {m: [] for m in METRIC_SECTION}      # metric -> [(source, value, note)]
HEADLINES = []                              # (date, source, tag, title, url)
ISSUES = []                                 # (source, what, error)
STATUS = OrderedDict()
CTX = {"name": TICKER, "sector": ""}
BREAKDOWN = {}      # metric -> {"date": ..., "items": [{"name", "value", "share"}]}  (FMP segments)
FRED_DATES = {}     # metric -> observation date
FB = {}             # fallback statements for SEC line items: provider -> raw statement data



def add(metric, source, value, note=""):
    ROWS[metric].append((source, value, note))


# (source, metric) pairs where the number is a field the source returns as-is.
# Everything else in the table is computed by this script from other values.
DIRECT = {
    ("EDGAR", "Revenue (latest quarter)"), ("EDGAR", "Cash on hand"),
    ("EDGAR", "Average interest rate"), ("EDGAR", "Debt maturity schedule"),
    *{("FMP", m) for m in ("EBITDA", "EBITDA margin", "Market cap", "EV/EBITDA", "Revenue (latest quarter)",
                           "Gross margin", "Operating margin", "Net margin", "Current ratio", "Quick ratio",
                           "Cash on hand", "Net debt / EBITDA", "Total debt", "Net debt")},
    *{("yfinance", m) for m in ("EBITDA", "EBITDA margin", "Market cap", "EV/EBITDA", "Gross margin",
                                "Operating margin", "Net margin", "Current ratio", "Quick ratio",
                                "Cash on hand", "Total debt", "Revenue (latest quarter)")},
}


def kind_of(source, value):
    if source in ("Finnhub", "FRED"):
        return "direct"
    if str(value).endswith("(Yahoo)"):
        return "direct"
    return "-" if source == "-" else "derived"


def kind_for(metric, source, value):
    if str(value).startswith("n/a") or value == "no data":
        return "-"
    if kind_of(source, value) != "derived":
        return kind_of(source, value)
    return "direct" if (source, metric) in DIRECT else "derived"


# --------------------------------------------------------------------------- helpers
def get_json(url, params=None, headers=None):
    r = requests.get(url, params=params, headers=headers, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def redact(text):
    """Strip API keys from error text (requests puts the full URL, key included, in its messages)."""
    return re.sub(r"(?i)\b(apikey|api_key|token|key)=[^&\s'\")]+", r"\1=***", str(text))


def attempt(source, what, fn):
    """Run fn; on failure log an issue (e.g. paywalled endpoint) and return None."""
    try:
        return fn()
    except Exception as e:
        ISSUES.append((source, what, f"{type(e).__name__}: {redact(e)[:130]}"))
        return None


def div(a, b):
    return None if a is None or b in (None, 0) else a / b


def growth(a, b):
    r = div(a, b)
    return None if r is None else r - 1


class Num(str):
    """Display text for the table that also carries the unrounded number (.raw) for the JSON."""
    def __new__(cls, text, raw=None):
        o = super().__new__(cls, text)
        o.raw = raw
        return o


def lab(n, suffix):
    return Num(f"{n}{suffix}", getattr(n, "raw", None))


def fm(x):
    if x is None:
        return Num("n/a")
    s = "-" if x < 0 else ""
    a = abs(x)
    for k, u in ((1e12, "T"), (1e9, "B"), (1e6, "M")):
        if a >= k:
            return Num(f"{s}${a / k:,.2f}{u}", x)
    return Num(f"{s}${a:,.0f}", x)


def fx(x):
    return Num("n/a") if x is None else Num(f"{x:.2f}x", x)


def fp(x):  # x is a fraction
    return Num("n/a") if x is None else Num(f"{x * 100:.1f}%", x)


def pct_in(x):  # Finnhub reports percents already
    return None if x is None else x / 100


def pick(d, *names):
    for n in names:
        if isinstance(d, dict) and d.get(n) is not None:
            return d[n]
    return None


def first(x):
    if isinstance(x, list):
        return x[0] if x else {}
    return x if isinstance(x, dict) else {}


def clean_name(n):
    n = re.sub(r"[,\s]+(inc\.?|corp\.?|corporation|co\.?|ltd\.?|plc|holdings?|company|/de/)\b.*$",
               "", n.strip(), flags=re.I)
    return n.title() if n.isupper() else n


# --------------------------------------------------------------------------- EDGAR
FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A"}
MAT = "LongTermDebtMaturitiesRepaymentsOfPrincipal"
TAGS_REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
            "RevenueFromContractWithCustomerIncludingAssessedTax"]
FY_TAGS = {
    "rev": (TAGS_REV, "annual"),
    "gross": (["GrossProfit"], "annual"),
    "op": (["OperatingIncomeLoss"], "annual"),
    "da": (["DepreciationDepletionAndAmortization", "DepreciationAndAmortization",
            "DepreciationAmortizationAndAccretionNet"], "annual"),
    "net": (["NetIncomeLoss", "ProfitLoss"], "annual"),
    "interest": (["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt",
                  "InterestAndDebtExpense", "InterestPaidNet", "InterestPaid"], "annual"),
    "capex": (["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], "annual"),
    "taxes": (["IncomeTaxesPaidNet", "IncomeTaxesPaid"], "annual"),
    "cash": (["CashAndCashEquivalentsAtCarryingValue",
              "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], "instant"),
    "sti": (["ShortTermInvestments", "MarketableSecuritiesCurrent",
             "AvailableForSaleSecuritiesDebtSecuritiesCurrent"], "instant"),
    "ar": (["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], "instant"),
    "ca": (["AssetsCurrent"], "instant"),
    "cl": (["LiabilitiesCurrent"], "instant"),
    "ltd": (["LongTermDebt"], "instant"),
    "ltd_nc": (["LongTermDebtNoncurrent"], "instant"),
    "ltd_cur": (["LongTermDebtCurrent"], "instant"),
    "debt_cur": (["DebtCurrent"], "instant"),
    "stb": (["CommercialPaper", "ShortTermBorrowings"], "instant"),
    "mat1": ([MAT + "InNextTwelveMonths"], "instant"),
    "mat2": ([MAT + "InYearTwo"], "instant"),
    "mat3": ([MAT + "InYearThree"], "instant"),
    "mat4": ([MAT + "InYearFour"], "instant"),
    "mat5": ([MAT + "InYearFive"], "instant"),
    "mat6": ([MAT + "AfterYearFive"], "instant"),
    "rate": (["DebtWeightedAverageInterestRate", "LongTermDebtWeightedAverageInterestRate"], "instant"),
}


def ddays(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def best_rows(facts, tags, unit="USD"):
    """Of the candidate tags, use the one with the most recent data (companies switch tags)."""
    best_tag, best_rows_, best_end = None, [], ""
    for tag in tags:
        node = facts.get("us-gaap", {}).get(tag)
        if not node or unit not in node["units"]:
            continue
        rows = [r for r in node["units"][unit] if r.get("form") in FORMS]
        if rows and max(r["end"] for r in rows) > best_end:
            best_tag, best_rows_, best_end = tag, rows, max(r["end"] for r in rows)
    return best_tag, best_rows_


def duration_series(rows, lo, hi):
    out = {}
    for r in rows:
        if "start" not in r:
            continue
        if lo <= ddays(r["start"], r["end"]) <= hi:
            k = (r["start"], r["end"])
            if k not in out or r["filed"] > out[k]["filed"]:
                out[k] = r
    return out


def quarterly_with_q4(rows):
    """Discrete quarters from 10-Qs, plus Q4 derived as 10-K annual minus the three 10-Q quarters."""
    ann, qs = duration_series(rows, 350, 380), duration_series(rows, 80, 100)
    out = [{"end": e, "val": r["val"], "derived": False, "accn": r["accn"], "filed": r["filed"]}
           for (s, e), r in qs.items()]
    for (s, e), a in ann.items():
        inside = [k for k in qs if k[0] >= s and k[1] < e]
        if len(inside) == 3 and not any(q["end"] == e for q in out):
            out.append({"end": e, "val": a["val"] - sum(qs[k]["val"] for k in inside),
                        "derived": True, "accn": a["accn"], "filed": a["filed"]})
    return sorted(out, key=lambda q: q["end"])


def value_at(facts, tags, end, kind, unit="USD"):
    for tag in tags:
        node = facts.get("us-gaap", {}).get(tag)
        if not node or unit not in node["units"]:
            continue
        cands = []
        for r in node["units"][unit]:
            if r.get("form") not in FORMS or r["end"] != end:
                continue
            if kind == "instant" and "start" in r:
                continue
            if kind == "annual" and not ("start" in r and 350 <= ddays(r["start"], r["end"]) <= 380):
                continue
            cands.append(r)
        if cands:
            r = max(cands, key=lambda x: x["filed"])
            return r["val"], tag, r
    return None, None, None


def fy_pack(facts, end):
    return {k: value_at(facts, tags, end, kind, "pure" if k == "rate" else "USD")
            for k, (tags, kind) in FY_TAGS.items()}


def ttm_flow(facts, tags, E):
    """Trailing twelve months for a flow item ending at E: FY + current YTD - prior-year YTD."""
    for tag in tags:
        node = facts.get("us-gaap", {}).get(tag)
        if not node or "USD" not in node["units"]:
            continue
        rows = [r for r in node["units"]["USD"] if r.get("form") in FORMS and "start" in r]
        cur = [r for r in rows if r["end"] == E]
        if not cur:
            continue
        ytd = max(cur, key=lambda r: (ddays(r["start"], r["end"]), r["filed"]))
        d = ddays(ytd["start"], ytd["end"])
        if d >= 350:
            return ytd["val"], tag, ytd
        prior = [r for r in rows if abs(ddays(r["end"], E) - 365) <= 10 and abs(ddays(r["start"], r["end"]) - d) <= 10]
        fyrows = [r for r in rows if 350 <= ddays(r["start"], r["end"]) <= 380 and 0 <= ddays(r["end"], ytd["start"]) <= 5]
        if prior and fyrows:
            py = max(prior, key=lambda r: r["filed"])
            f = max(fyrows, key=lambda r: r["filed"])
            return f["val"] + ytd["val"] - py["val"], tag, ytd
    return None, None, None


def ttm_pack(facts, E, p_fy):
    """Flows as TTM to E, balance sheet at E. Falls back to the FY value when E has none."""
    p, fell = {}, []
    for k, (tags, kind) in FY_TAGS.items():
        if k.startswith("mat") or k == "rate":
            p[k] = p_fy[k]
        elif kind == "annual":
            p[k] = ttm_flow(facts, tags, E)
        else:
            p[k] = value_at(facts, tags, E, "instant")
        if p[k][0] is None and p_fy[k][0] is not None and not (k.startswith("mat") or k == "rate"):
            p[k] = p_fy[k]
            fell.append(k)
    return p, fell


def derive(p):
    g = lambda k: p[k][0]
    ebitda = g("op") + g("da") if g("op") is not None and g("da") is not None else None
    ltd = g("ltd")
    if ltd is None and g("ltd_nc") is not None:
        cur = g("ltd_cur") if g("ltd_cur") is not None else (g("debt_cur") or 0)
        ltd = g("ltd_nc") + cur
    debt = None if ltd is None else ltd + (g("stb") or 0)
    net_debt = None if debt is None or g("cash") is None else debt - g("cash") - (g("sti") or 0)
    return {"ebitda": ebitda, "debt": debt, "net_debt": net_debt, "lev": div(net_debt, ebitda)}


def cite(p, *keys):
    for k in keys:
        r = p[k][2]
        if r:
            return f"{p[k][1]} | period end {r['end']}, filed {r['filed']}, accn {r['accn']}"
    return "tag not found"


def miss(p, *keys):
    m = [k for k in keys if p[k][0] is None]
    return f"; missing: {', '.join(m)}" if m else ""


def collect_edgar():
    S = "EDGAR"
    H = {"User-Agent": os.getenv("SEC_USER_AGENT", "")}
    tickers = get_json("https://www.sec.gov/files/company_tickers.json", headers=H)
    m = next((v for v in tickers.values() if v["ticker"] == TICKER), None)
    if not m:
        raise RuntimeError(f"{TICKER} not in EDGAR ticker map (delisted or acquired, ticker changed, or non-US filer)")
    CTX["name"] = clean_name(m["title"])
    CTX["cik"] = str(m["cik_str"]).zfill(10)
    time.sleep(0.2)
    facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{str(m['cik_str']).zfill(10)}.json",
                     headers=H)["facts"]

    _, rrows = best_rows(facts, TAGS_REV)
    ann = duration_series(rrows, 350, 380)
    if not ann:
        raise RuntimeError("no annual revenue found in XBRL facts")
    fy_ends = sorted({e for (_, e) in ann}, reverse=True)
    fe = fy_ends[0]
    CTX["facts"] = facts
    arow = next(r for (s, e), r in ann.items() if e == fe)
    p_fy = fy_pack(facts, fe)
    if PERIOD == "ttm":
        E = max(r["end"] for r in rrows)
        p, fell = ttm_pack(facts, E, p_fy)
        fy = f"TTM to {E}" + (f" (FY values used for: {', '.join(fell)})" if fell else "")
    else:
        p, fy = p_fy, f"FY end {fe}"
    d = derive(p)
    rev = p["rev"][0]

    add("EBITDA", S, fm(d["ebitda"]), f"OpIncome + D&A | {cite(p, 'op', 'da')}{miss(p, 'op', 'da')}")
    add("EBITDA margin", S, fp(div(d["ebitda"], rev)), f"EBITDA / revenue | {fy}")

    base = next((r for (s, e), r in ann.items() if 1080 <= ddays(e, fe) <= 1110), None)
    cagr = None if not base or not rev or base["val"] <= 0 else (rev / base["val"]) ** (1 / 3) - 1
    add("3-yr revenue growth (CAGR)", S, fp(cagr), f"annual revenue {base['end'] if base else '?'} -> {fe}")

    ql = quarterly_with_q4(rrows)
    if ql:
        lat = ql[-1]
        prev = ql[-2] if len(ql) > 1 else None
        yo = next((q for q in reversed(ql[:-1]) if 350 <= ddays(q["end"], lat["end"]) <= 380), None)
        tagnote = f"qtr end {lat['end']}, accn {lat['accn']}" + (" (Q4 derived: 10-K minus 9M)" if lat["derived"] else "")
        add("Revenue (latest quarter)", S, fm(lat["val"]), tagnote)
        add("Revenue QoQ", S, fp(growth(lat["val"], prev["val"]) if prev else None),
            f"vs qtr ending {prev['end'] if prev else '?'}")
        add("Revenue YoY", S, fp(growth(lat["val"], yo["val"]) if yo else None),
            f"vs qtr ending {yo['end'] if yo else '?'}")
        fyq = [q for q in ql if arow["start"] < q["end"] <= fe]
        if len(fyq) == 4:
            peak = max(fyq, key=lambda q: q["val"])
            add("Seasonality (peak quarter share)", S, fp(peak["val"] / sum(q["val"] for q in fyq)),
                f"peak quarter ends {peak['end']}, share of {fy} revenue")
    else:
        for mname in ("Revenue (latest quarter)", "Revenue QoQ", "Revenue YoY"):
            add(mname, S, "n/a", "no quarterly revenue found")

    add("Gross margin", S, fp(div(p["gross"][0], rev)), f"GrossProfit / revenue | {cite(p, 'gross')}")
    add("Operating margin", S, fp(div(p["op"][0], rev)), f"OperatingIncome / revenue | {fy}")
    add("Net margin", S, fp(div(p["net"][0], rev)), f"NetIncome / revenue | {fy}")

    g = lambda k: p[k][0]
    quick = div((g("cash") or 0) + (g("sti") or 0) + (g("ar") or 0), g("cl")) if g("cash") is not None and g("ar") is not None else None
    add("Current ratio", S, fx(div(g("ca"), g("cl"))), f"AssetsCurrent / LiabilitiesCurrent | {fy}")
    add("Quick ratio", S, fx(quick), f"(cash + ST investments + receivables) / current liabilities | {fy}{miss(p, 'cash', 'ar')}")
    add("Cash on hand", S, fm(g("cash")), cite(p, "cash") + f"; excludes ST investments ({fm(g('sti'))})")

    principal, est = g("mat1"), False
    if principal is None:
        principal = g("ltd_cur") if g("ltd_cur") is not None else g("debt_cur")
        est = principal is not None
    num = None if d["ebitda"] is None else d["ebitda"] - (g("capex") or 0) - (g("taxes") or 0)
    den = None if g("interest") is None or principal is None else g("interest") + principal
    fccr = div(num, den)
    val = "n/a" if fccr is None else f"{fccr:.2f}x {'PASS' if fccr >= FCCR_THRESHOLD else 'FAIL'} (>= {FCCR_THRESHOLD}x)"
    add("Fixed charge coverage ratio", S, val,
        "(EBITDA - capex - cash taxes) / (interest + next-12m principal)"
        + ("; principal ESTIMATED from current debt" if est else "")
        + miss(p, "interest", "capex", "taxes") + f" | {fy}")

    if fccr is None:
        gaps = [n for n, v in (("EBITDA", d["ebitda"]), ("interest", g("interest")), ("principal", principal)) if v is None]
        us = facts.get("us-gaap", {})
        cand = sorted((t for t in us if "Interest" in t and ("Expense" in t or "Paid" in t)),
                      key=lambda t: max((r["end"] for u in us[t]["units"].values() for r in u), default=""), reverse=True)[:8]
        ISSUES.append(("EDGAR", f"FCCR is n/a, missing: {', '.join(gaps)}",
                       "interest-related us-gaap tags this company does file: " + (", ".join(cand) or "none")
                       + " (add the right one to FY_TAGS['interest'] if it is the interest expense)"))
    add("Net debt / EBITDA", S, fx(d["lev"]), f"(total debt - cash - ST investments) / EBITDA | {fy}")
    trend = []
    for e in sorted(fy_ends[:4]):
        trend.append(f"{e[:4]}: {fx(derive(fy_pack(facts, e))['lev'])}")
    add("Net debt / EBITDA trend", S, f"{len(trend)} fiscal years", "oldest to newest: " + "  ".join(trend))

    add("Total debt", S, fm(d["debt"]), "long-term debt incl. current + CP/ST borrowings; leases excluded | " + cite(p, "ltd", "ltd_nc"))
    add("Net debt", S, fm(d["net_debt"]), f"total debt - cash - ST investments | {fy}")
    add("Average interest rate", S, fp(g("rate")), cite(p, "rate") if g("rate") is not None else "weighted-rate tag not found")
    add("Floating-rate share", S, "n/a", "not in companyfacts; needs 10-K debt footnote parsing")
    mats = [(l, g(k)) for l, k in (("Y1", "mat1"), ("Y2", "mat2"), ("Y3", "mat3"), ("Y4", "mat4"), ("Y5", "mat5"), ("5+", "mat6")) if g(k) is not None]
    if mats:
        pk = max(mats, key=lambda x: x[1])
        add("Debt maturity schedule", S, f"peak {pk[0]} ({fm(pk[1])})", "  ".join(f"{l}:{fm(v)}" for l, v in mats))
    else:
        add("Debt maturity schedule", S, "n/a", "maturity tags not found; needs footnote parsing")

    add("Customer concentration", S, "n/a", "dimensional XBRL not in companyfacts; needs 10-K text parsing")


# --------------------------------------------------------------------------- FMP
def collect_fmp():
    S, key = "FMP", os.getenv("FMP_API_KEY")
    base = "https://financialmodelingprep.com/stable"
    call = lambda path, **kw: get_json(f"{base}/{path}", {"symbol": TICKER, "apikey": key, **kw})

    prof = first(attempt(S, "profile", lambda: call("profile")))
    km = first(attempt(S, "key-metrics-ttm", lambda: call("key-metrics-ttm")))
    rt = first(attempt(S, "ratios-ttm", lambda: call("ratios-ttm")))
    ann = attempt(S, "income-statement annual", lambda: call("income-statement", period="annual", limit=4)) or []
    qtr = attempt(S, "income-statement quarter", lambda: call("income-statement", period="quarter", limit=5)) or []
    bs_all = attempt(S, "balance-sheet annual", lambda: call("balance-sheet-statement", period="annual", limit=4)) or []
    bs = first(bs_all)
    cf_all = attempt(S, "cash-flow annual", lambda: call("cash-flow-statement", period="annual", limit=4)) or []
    FB["FMP"] = {"income": ann, "cash": cf_all, "bs": bs_all}
    CTX["sector"] = CTX["sector"] or (prof.get("sector") or "")

    if ann:
        a0 = ann[0]
        add("EBITDA", S, fm(a0.get("ebitda")), f"FY {a0.get('date')} income statement")
        add("EBITDA margin", S, fp(pick(rt, "ebitdaMarginTTM") if pick(rt, "ebitdaMarginTTM") is not None
                                   else div(a0.get("ebitda"), a0.get("revenue"))), "ratios-ttm ebitdaMarginTTM")
        if len(ann) >= 4:
            add("3-yr revenue growth (CAGR)", S, fp((a0["revenue"] / ann[3]["revenue"]) ** (1 / 3) - 1 if ann[3].get("revenue") else None),
                f"annual revenue {ann[3].get('date')} -> {a0.get('date')}")
    add("Market cap", S, fm(pick(prof, "marketCap", "mktCap")), "profile (live)")
    add("EV/EBITDA", S, fx(pick(km, "evToEBITDATTM", "enterpriseValueOverEBITDATTM")), "key-metrics-ttm")
    if qtr:
        add("Revenue (latest quarter)", S, fm(qtr[0].get("revenue")), f"qtr {qtr[0].get('date')}")
        add("Revenue QoQ", S, fp(growth(qtr[0].get("revenue"), qtr[1].get("revenue")) if len(qtr) > 1 else None), "latest vs prior quarter")
        add("Revenue YoY", S, fp(growth(qtr[0].get("revenue"), qtr[4].get("revenue")) if len(qtr) > 4 else None), "latest vs same quarter last year")
    add("Gross margin", S, fp(pick(rt, "grossProfitMarginTTM")), "ratios-ttm")
    add("Operating margin", S, fp(pick(rt, "operatingProfitMarginTTM")), "ratios-ttm")
    add("Net margin", S, fp(pick(rt, "netProfitMarginTTM")), "ratios-ttm")
    add("Current ratio", S, fx(pick(rt, "currentRatioTTM") or pick(km, "currentRatioTTM")), "TTM")
    add("Quick ratio", S, fx(pick(rt, "quickRatioTTM")), "ratios-ttm")
    add("Cash on hand", S, fm(pick(bs, "cashAndCashEquivalents")), f"FY {bs.get('date')} balance sheet")
    # FMP has no fixed charge coverage field (ratios-ttm only has interestCoverageRatioTTM and
    # debtServiceCoverageRatioTTM), so FCCR comes from EDGAR only.
    add("Net debt / EBITDA", S, fx(pick(km, "netDebtToEBITDATTM")), "key-metrics-ttm")
    add("Total debt", S, fm(pick(bs, "totalDebt")), f"FY {bs.get('date')} balance sheet")
    add("Net debt", S, fm(pick(bs, "netDebt")), f"FY {bs.get('date')} balance sheet")

    def seg(path, metric):
        x = attempt(S, path, lambda: call(path, period="annual", structure="flat"))
        data = first(x).get("data") if x else None
        if isinstance(data, dict):
            nums = {k: v for k, v in data.items() if isinstance(v, (int, float))}
            tot = sum(nums.values())
            top = sorted(nums.items(), key=lambda kv: -kv[1])[:3]
            if tot and top:
                BREAKDOWN[metric] = {"date": first(x).get("date") or first(x).get("fiscalYear"),
                                     "items": [{"name": k, "value": v, "share": v / tot}
                                               for k, v in sorted(nums.items(), key=lambda kv: -kv[1])]}
                add(metric, S, f"top: {top[0][0]} {fp(top[0][1] / tot)}",
                    "; ".join(f"{k} {fp(v / tot)}" for k, v in top) + f" (FY {first(x).get('fiscalYear', first(x).get('date'))})")

    seg("revenue-product-segmentation", "Revenue by segment")
    seg("revenue-geographic-segmentation", "Revenue by region")


# --------------------------------------------------------------------------- Finnhub
def collect_finnhub():
    S = "Finnhub"
    m = get_json("https://finnhub.io/api/v1/stock/metric",
                 {"symbol": TICKER, "metric": "all", "token": os.getenv("FINNHUB_API_KEY")}).get("metric", {})
    if not m:
        raise RuntimeError("empty metric payload (ticker not covered)")
    mc = m.get("marketCapitalization")
    add("Market cap", S, fm(mc * 1e6 if mc else None), "/stock/metric (reported in $M)")
    add("3-yr revenue growth (CAGR)", S, fp(pct_in(m.get("revenueGrowth3Y"))), "revenueGrowth3Y")
    add("Revenue YoY", S, fp(pct_in(m.get("revenueGrowthQuarterlyYoy"))), "revenueGrowthQuarterlyYoy")
    add("Gross margin", S, fp(pct_in(m.get("grossMarginTTM"))), "TTM")
    add("Operating margin", S, fp(pct_in(m.get("operatingMarginTTM"))), "TTM")
    add("Net margin", S, fp(pct_in(m.get("netProfitMarginTTM"))), "TTM")
    add("Current ratio", S, fx(m.get("currentRatioQuarterly")), "latest quarter")
    add("Quick ratio", S, fx(m.get("quickRatioQuarterly")), "latest quarter")
    add("Beta", S, Num("n/a") if m.get("beta") is None else Num(f"{m['beta']:.2f}", m["beta"]), "/stock/metric")


# --------------------------------------------------------------------------- yfinance
def collect_yfinance():
    import numpy as np
    import yfinance as yf

    S = "yfinance"
    t = yf.Ticker(TICKER)
    info = t.info or {}
    CTX["sector"] = CTX["sector"] or info.get("sector", "")
    if CTX["name"] == TICKER and info.get("shortName"):
        CTX["name"] = clean_name(info["shortName"])

    FB["yfinance"] = {k: attempt(S, k, lambda a=a: getattr(t, a)) for k, a in (
        ("income", "income_stmt"), ("cash", "cashflow"), ("bs", "balance_sheet"),
        ("qincome", "quarterly_income_stmt"), ("qcash", "quarterly_cashflow"), ("qbs", "quarterly_balance_sheet"))}
    eb, td, tc = info.get("ebitda"), info.get("totalDebt"), info.get("totalCash")
    nd = None if td is None or tc is None else td - tc
    add("EBITDA", S, fm(eb), "Yahoo TTM field")
    add("EBITDA margin", S, fp(info.get("ebitdaMargins")), "Yahoo TTM field")
    add("Market cap", S, fm(info.get("marketCap")), "Yahoo (live)")
    add("EV/EBITDA", S, fx(info.get("enterpriseToEbitda")), "Yahoo field")
    add("Gross margin", S, fp(info.get("grossMargins")), "Yahoo field")
    add("Operating margin", S, fp(info.get("operatingMargins")), "Yahoo field")
    add("Net margin", S, fp(info.get("profitMargins")), "Yahoo field")
    add("Current ratio", S, fx(info.get("currentRatio")), "Yahoo field")
    add("Quick ratio", S, fx(info.get("quickRatio")), "Yahoo field")
    add("Cash on hand", S, fm(tc), "Yahoo field")
    add("Total debt", S, fm(td), "Yahoo field (may include leases)")
    add("Net debt", S, fm(nd), "totalDebt - totalCash")
    add("Net debt / EBITDA", S, fx(div(nd, eb)), "computed from Yahoo fields")

    def rev_series(df):
        if df is None or "Total Revenue" not in df.index:
            return []
        return [float(v) for v in df.loc["Total Revenue"].sort_index(ascending=False).dropna().values]

    q = rev_series(attempt(S, "quarterly_income_stmt", lambda: t.quarterly_income_stmt))
    a = rev_series(attempt(S, "income_stmt", lambda: t.income_stmt))
    if info.get("revenueGrowth") is not None:
        add("Revenue YoY", S, lab(fp(info['revenueGrowth']), " (Yahoo)"), "Yahoo field revenueGrowth (latest quarter YoY)")
    if q:
        add("Revenue (latest quarter)", S, fm(q[0]), "quarterly_income_stmt")
        add("Revenue QoQ", S, fp(growth(q[0], q[1]) if len(q) > 1 else None), "latest vs prior quarter")
        add("Revenue YoY", S, fp(growth(q[0], q[4]) if len(q) > 4 else None),
            "latest vs same quarter last year" + ("" if len(q) > 4 else " (only <5 quarters available)"))
    if len(a) >= 4 and a[3]:
        add("3-yr revenue growth (CAGR)", S, fp((a[0] / a[3]) ** (1 / 3) - 1), "annual income_stmt")

    px = attempt(S, "price history", lambda: yf.download(list(dict.fromkeys([TICKER, "SPY"])), period="1y",
                                                         auto_adjust=True, progress=False)["Close"].dropna())
    stale = px is not None and TICKER in px and (len(px) < 120 or (date.today() - px.index[-1].date()).days > 10)
    if stale:
        ISSUES.append((S, "price history", f"only {len(px)} usable daily rows, last {str(px.index[-1])[:10]} "
                                           "(delisted, acquired or newly listed?); beta, volatility, drawdown skipped"))
    if px is not None and TICKER in px and not stale:
        CTX["px_end"] = str(px.index[-1])[:10]
        r = px.pct_change().dropna()
        if "SPY" in px and TICKER != "SPY":
            b = float(r[TICKER].cov(r['SPY']) / r['SPY'].var())
            add("Beta", S, Num(f"{b:.2f} (calc)", b), "1y daily returns vs SPY")
        if info.get("beta") is not None:
            add("Beta", S, Num(f"{info['beta']:.2f} (Yahoo)", info["beta"]), "Yahoo field")
        add("Annualized volatility", S, fp(float(r[TICKER].std() * np.sqrt(252))), "1y daily returns")
        add("Max drawdown (1y)", S, fp(float((px[TICKER] / px[TICKER].cummax() - 1).min())), "1y closing prices")


# --------------------------------------------------------------------------- FRED
def collect_fred():
    for sid, metric, unit in (("VIXCLS", "VIX", ""), ("BAMLH0A0HYM2", "High-yield spread", "%"),
                              ("T10Y2Y", "10Y-2Y yield curve", "%")):
        data = attempt("FRED", sid, lambda sid=sid: get_json(
            "https://api.stlouisfed.org/fred/series/observations",
            {"series_id": sid, "api_key": os.getenv("FRED_API_KEY"), "file_type": "json",
             "sort_order": "desc", "limit": 5}))
        obs = [o for o in (data or {}).get("observations", []) if o["value"] != "."]
        if obs:
            FRED_DATES[metric] = obs[0]["date"]
            add(metric, "FRED", Num(f"{float(obs[0]['value']):.2f}{unit}", float(obs[0]["value"])),
                f"series {sid}, {obs[0]['date']}")


# --------------------------------------------------------------------------- news
RISK_TAGS = OrderedDict([
    ("Legal", ["lawsuit", "sued", "sues", "class action", "settlement", "litigation", "antitrust"]),
    ("Regulatory", ["investigation", "probe", "subpoena", "fined", "regulator", "ftc", "doj"]),
    ("Fraud", ["fraud", "scandal", "misconduct", "whistleblower"]),
    ("Distress", ["bankruptcy", "default", "downgrade", "layoffs", "going concern", "restructuring"]),
    ("Cyber/Safety", ["breach", "hack", "recall", "cyberattack"]),
])


def tag_headline(title):
    t = title.lower()
    for tag, words in RISK_TAGS.items():
        if any(re.search(r"\b" + re.escape(w) + r"\b", t) for w in words):
            return tag
    return "-"


def rep_flag(n):
    return "Low" if n == 0 else ("Medium" if n <= 2 else "High")


def log_headlines(source, items):
    core = CTX["name"].split()[0].lower()
    kept = [(d, source, tag_headline(t), t, u) for d, t, u in items if core in t.lower()]
    HEADLINES.extend(kept)
    return kept, sum(1 for k in kept if k[2] != "-")


def collect_newsapi():
    arts = get_json("https://newsapi.org/v2/everything",
                    {"q": f'"{CTX["name"]}"', "searchIn": "title", "from": (date.today() - timedelta(days=30)).isoformat(),
                     "pageSize": 50, "sortBy": "publishedAt", "language": "en",
                     "apiKey": os.getenv("NEWSAPI_KEY")}).get("articles", [])
    items = [(a["publishedAt"][:10], a.get("title") or "", a.get("url", "")) for a in arts]
    kept, flagged = log_headlines("NewsAPI", items)
    add("Reputation flag", "NewsAPI", f"{rep_flag(flagged)} ({flagged} risk-tagged of {len(kept)})",
        "last 30d, titles only, name-filtered, keyword tags; free tier is delayed 24h")


# --------------------------------------------------------------------------- run + print
def count_rows(src):
    return sum(1 for rs in ROWS.values() for r in rs if r[0] == src)


def run(name, fn, env=None):
    if env and not os.getenv(env):
        STATUS[name] = f"SKIPPED (set {env})"
        return
    try:
        fn()
    except Exception as e:
        ISSUES.append((name, "collector", f"{type(e).__name__}: {redact(e)[:150]}"))
    n, iss = count_rows(name), sum(1 for i in ISSUES if i[0] == name)
    STATUS[name] = f"FAILED" if n == 0 else (f"OK ({n} values)" if iss == 0 else f"PARTIAL ({n} values, {iss} issue(s))")


def trunc(s, n):
    s = str(s)
    return s if len(s) <= n else s[:n - 3] + "..."


def print_table():
    w = (34, 9, 30, 7)
    head = f"{'Metric':<{w[0]}} | {'Source':<{w[1]}} | {'Value':<{w[2]}} | {'Type':<{w[3]}} | Note"
    print("\n" + head + "\n" + "-" * 150)
    for section, metrics in LAYOUT.items():
        print(f"== {section.upper()} ==")
        for m in metrics:
            rows = ROWS[m] or [("-", "no data", "no source returned this metric")]
            for i, (src, val, note) in enumerate(rows):
                label = m if i == 0 else ""
                print(f"{trunc(label, w[0]):<{w[0]}} | {src:<{w[1]}} | {trunc(val, w[2]):<{w[2]}} | "
                      f"{kind_for(m, src, val):<{w[3]}} | {note}")
    print("-" * 150)
    print("Type: direct = returned by the source as-is; derived = computed here from other values")



# --------------------------------------------------------------------------- fallbacks for SEC line items
# When EDGAR has no value for a line item (e.g. Apple stopped tagging interest expense), fill it from
# the other sources, most reliable first: FMP (as-reported statements), then yfinance.
# Only fills gaps; an SEC value is never overwritten. Fallback values carry a per-value "source".
FALLBACK_ORDER = ["FMP", "yfinance"]
OUTFLOW = {"capex", "interest_paid", "taxes_paid", "dividends", "buybacks", "debt_repaid", "interest_expense"}
NO_ZERO = {"interest_expense", "interest_paid"}   # providers return 0 when they have nothing; treat as missing
FMP_MAP = {
    "income": {"revenue": "revenue", "cogs": "costOfRevenue", "gross_profit": "grossProfit",
               "sga": "sellingGeneralAndAdministrativeExpenses", "operating_income": "operatingIncome",
               "net_income": "netIncome", "da": "depreciationAndAmortization", "interest_expense": "interestExpense",
               "income_tax_expense": "incomeTaxExpense", "pretax_income": "incomeBeforeTax"},
    "cash": {"cfo": "netCashProvidedByOperatingActivities", "capex": "capitalExpenditure", "interest_paid": "interestPaid",
             "taxes_paid": "incomeTaxesPaid", "dividends": "netDividendsPaid", "buybacks": "commonStockRepurchased",
             "debt_repaid": "debtRepayment"},
    "bs": {"cash": "cashAndCashEquivalents", "st_investments": "shortTermInvestments", "receivables": "netReceivables",
           "inventory": "inventory", "payables": "accountPayables", "current_assets": "totalCurrentAssets",
           "current_liabilities": "totalCurrentLiabilities", "total_assets": "totalAssets",
           "total_liabilities": "totalLiabilities", "equity": "totalStockholdersEquity",
           "liabilities_and_equity": "totalLiabilitiesAndTotalEquity"},
}
YF_MAP = {
    "income": {"revenue": "Total Revenue", "cogs": "Cost Of Revenue", "gross_profit": "Gross Profit",
               "sga": "Selling General And Administration", "operating_income": "Operating Income",
               "net_income": "Net Income", "da": "Reconciled Depreciation", "interest_expense": "Interest Expense",
               "income_tax_expense": "Tax Provision", "pretax_income": "Pretax Income"},
    "cash": {"cfo": "Operating Cash Flow", "capex": "Capital Expenditure", "interest_paid": "Interest Paid Supplemental Data",
             "taxes_paid": "Income Tax Paid Supplemental Data", "dividends": "Cash Dividends Paid",
             "buybacks": "Repurchase Of Capital Stock", "debt_repaid": "Repayment Of Debt", "debt_issued": "Issuance Of Debt"},
    "bs": {"cash": "Cash And Cash Equivalents", "st_investments": "Other Short Term Investments",
           "receivables": "Accounts Receivable", "inventory": "Inventory", "payables": "Accounts Payable",
           "current_assets": "Current Assets", "current_liabilities": "Current Liabilities",
           "total_assets": "Total Assets", "total_liabilities": "Total Liabilities Net Minority Interest",
           "equity": "Stockholders Equity", "ltd_noncurrent": "Long Term Debt", "debt_current": "Current Debt"},
}


def _near(a, b, tol=7):
    return abs(ddays(str(a)[:10], str(b)[:10])) <= tol


def _yf_cell(df, label, e):
    try:
        if df is None or label not in df.index:
            return None
        for c in df.columns:
            if _near(c, e):
                v = df.loc[label, c]
                return None if v != v else float(v)     # NaN -> None
    except Exception:
        pass
    return None


def _yf_ttm(df, label, e):
    try:
        if df is None or label not in df.index:
            return None
        cols = sorted(df.columns, reverse=True)
        if len(cols) < 4 or not _near(cols[0], e):
            return None
        vals = [df.loc[label, c] for c in cols[:4]]
        return None if any(v != v for v in vals) else float(sum(vals))
    except Exception:
        return None


def fallback_value(name, e, flow, cur):
    """(value, provider) from the first fallback provider that has this item for period end e.
    cur = e is the trailing-twelve-month / latest period (a 10-Q is newer than the last 10-K)."""
    for prov in FALLBACK_ORDER:
        d = FB.get(prov)
        if not d:
            continue
        v = None
        if prov == "FMP" and not cur:       # FMP quarterly statements are paid, so annual only
            for st, mp in FMP_MAP.items():
                if name in mp:
                    row = next((r for r in d.get(st) or [] if _near(r.get("date", "0000-00-00"), e)), None)
                    v = row.get(mp[name]) if row else None
        elif prov == "yfinance":
            for st, mp in YF_MAP.items():
                if name in mp:
                    if cur:
                        v = (_yf_ttm if flow else _yf_cell)(d.get("q" + st), mp[name], e)
                    else:
                        v = _yf_cell(d.get(st), mp[name], e)
        if v is None or not isinstance(v, (int, float)):
            continue
        if name in OUTFLOW:
            v = abs(v)
        if v == 0 and name in NO_ZERO:
            continue
        return v, prov
    return None, None


# --------------------------------------------------------------------------- filing text (MD&A and debt note)
# Verbatim excerpts from the latest 10-K and 10-Q, cleaned and selected by topic. Nothing is summarized
# here; the memo layer writes the explanations and cites these excerpts.
TEXT_BUDGET = 60000        # characters across all excerpts
EXCERPT_MAX = 3500         # characters per excerpt
PARA_MAX = 1200            # a single longer paragraph is cut at a sentence end and marked [...]
DEBT_RE = re.compile(r"\b(debt|borrowings?|credit (facilit|agreement)|financing arrangements|notes payable)", re.I)
ITEM_RE = re.compile(r"^\s*item\s*(\d{1,2}[AB]?)\s*[\.\:\-–—]?\s*(.{0,150})$", re.I)
NOTE_RE = re.compile(r"^\s*(?:note\s+)?(\d{1,2})\s*[\.\:\-–—]\s*([A-Z][A-Za-z ,\-&'’]{2,90})$", re.I)
SEG_RE = re.compile(r"segment|geograph", re.I)
CONC_RE = re.compile(r"concentration|major customer|significant customer|revenues?$", re.I)
# (topic id, where, keywords, metrics it explains, max paragraphs)
# where: mdna = Item 7 (10-Q: Item 2), mrisk = Item 7A (10-Q: Item 3), business = Item 1, risks = Item 1A,
# debt / segments / concentration = the matching note to the financial statements
# order matters: specific topics come first so generic ones (results, liquidity) do not take their paragraphs
TOPICS = [
    ("debt_note", ["debt"], ["interest", "rate", "sofr", "floating", "variable", "fixed", "matur", "term loan",
                             "senior notes", "revolving", "credit agreement", "covenant", "principal"],
     ["interest_expense", "debt_rate_weighted", "floating_rate_share", "maturity_y1", "ltd_total", "fixed_charge_coverage_ratio"], 5),
    ("covenants", ["mdna", "debt"], ["covenant", "fixed charge", "leverage ratio", "coverage ratio", "in compliance"],
     ["fixed_charge_coverage_ratio", "net_debt_to_ebitda"], 3),
    ("market_risk", ["mrisk"], ["interest rate", "foreign currency", "exchange rate", "hypothetical", "equity price",
                                "fixed rate", "floating rate", "variable rate", "market risk"],
     ["floating_rate_share", "debt_rate_weighted", "beta", "annualized_volatility"], 3),
    ("segments_and_geography", ["mdna", "segments"], ["segment", "geograph", "region", "international", "americas", "europe",
                                                      "asia", "united states", "by product", "by category"],
     ["revenue_by_segment", "revenue_by_region"], 4),
    ("customers_and_seasonality", ["concentration", "business", "mdna", "risks"],
     ["seasonal", "fourth quarter", "holiday", "largest customer", "significant customer", "major customer",
      "customers accounted", "accounted for", "concentration of"],
     ["customer_concentration", "seasonality_peak_quarter_share", "revenue_quarterly"], 4),
    ("operating_costs", ["mdna"], ["cost of revenue", "cost of sales", "cost of goods", "research and development", "selling, general",
                                  "marketing", "depreciation", "amortization", "headcount", "freight", "tariff", "inflation"],
     ["cogs", "sga", "da", "ebitda", "ebitda_margin", "gross_margin", "operating_margin"], 4),
    ("cash_flows", ["mdna"], ["operating activities", "investing activities", "financing activities", "capital expenditures",
                             "purchases of property", "free cash flow", "share repurchase", "dividends paid", "working capital"],
     ["cfo", "capex", "dividends", "buybacks", "debt_repaid", "debt_issued", "fixed_charge_coverage_ratio"], 4),
    ("interest_and_tax", ["mdna"], ["interest expense", "interest income", "other income", "effective tax rate", "income tax",
                                    "provision for income taxes"],
     ["interest_expense", "net_interest_nonoperating", "income_tax_expense", "pretax_income", "net_income"], 3),
    ("liquidity_and_capital", ["mdna"], ["liquidity", "capital resources", "cash", "debt", "credit facility",
                                         "commercial paper", "repay", "borrow", "interest", "dividend", "repurchase"],
     ["cash", "st_investments", "current_ratio", "quick_ratio", "total_debt", "net_debt", "net_debt_to_ebitda"], 4),
    ("results_of_operations", ["mdna"], ["revenue", "net sales", "gross margin", "operating income", "increase", "decrease",
                                         "compared", "primarily", "due to", "driven by", "margin"],
     ["revenue", "revenue_yoy", "revenue_qoq", "revenue_cagr_3y", "gross_margin", "operating_margin", "net_margin"], 4),
]


def html_to_lines(html):
    """Filing HTML -> list of clean text lines (one paragraph per line); tables and XBRL header dropped."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    for t in soup.find_all(["script", "style", "table", "head"]):
        t.decompose()
    for t in soup.find_all(lambda x: x.name and x.name.lower() in ("ix:header", "ix:hidden")):
        t.decompose()
    for t in soup.find_all(lambda x: x.name in ("span", "a", "b", "i", "u", "font", "em", "strong", "sup", "sub")
                           or (x.name and x.name.startswith("ix:"))):
        t.unwrap()
    soup.smooth()
    out = []
    for raw in soup.get_text("\n").split("\n"):
        ln = re.sub(r"\s+", " ", raw.replace("\xa0", " ")).strip()
        if len(ln) < 3 or re.fullmatch(r"\d{1,3}", ln) or re.fullmatch(r"(?i)table of contents|part [iv]+", ln):
            continue
        if re.search(r"(?i)form 10-[kq]\s*\|\s*\d+$", ln):      # running page footers
            continue
        out.append(ln)
    return out


def find_sections(lines):
    """Item sections and the debt note. Headings repeat in the table of contents, so the longest span wins."""
    heads = [(i, m.group(1).upper(), m.group(2).strip()) for i, l in enumerate(lines) if (m := ITEM_RE.match(l))]
    items = {}
    for k, (i, num, title) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else len(lines)
        if num not in items or end - i > items[num][2] - items[num][1]:
            items[num] = (title, i, end)
    notes = [(i, m.group(1), m.group(2).strip()) for i, l in enumerate(lines) if (m := NOTE_RE.match(l))]
    allnotes = []
    for k, (i, num, title) in enumerate(notes):
        end = notes[k + 1][0] if k + 1 < len(notes) else len(lines)
        allnotes.append((f"Note {num}. {title}", title, lines[i + 1:min(end, i + 400)]))
    secs = {num: (f"Item {num}. {t}".strip(" ."), lines[a + 1:b]) for num, (t, a, b) in items.items()}
    return secs, allnotes


def pick_note(notes, rx):
    """The longest note whose title matches rx (headings can also appear in an index of notes)."""
    c = [(label, body) for label, title, body in notes if rx.search(title)]
    return max(c, key=lambda x: len(x[1])) if c else None


def _cut(p):
    if len(p) <= PARA_MAX:
        return p
    cut = max(p.rfind(". ", 0, PARA_MAX), p.rfind("; ", 0, PARA_MAX))
    return (p[:cut + 1] if cut > 200 else p[:PARA_MAX].rsplit(" ", 1)[0]) + " [...]"


def pick_paragraphs(lines, keywords, n):
    scored = []
    for i, p in enumerate(lines):
        if len(p) < 80 or "forward-looking" in p.lower():
            continue
        low = p.lower()
        hit = [k for k in keywords if k in low]
        if not hit:
            continue
        sc = 2 * len(hit) + sum(low.count(k) for k in hit) + (1 if re.search(r"[$%]", p) else 0)
        scored.append((sc, i, p))
    best = sorted(scored, key=lambda x: (-x[0], x[1]))[:n]
    return [p for _, _, p in sorted(best, key=lambda x: x[1])]


def extract_excerpts(html, form, period_end, url, used=None, budget=TEXT_BUDGET):
    """Excerpt entries for one filing. `used` is the set of paragraphs already sent (no repeats)."""
    used = set() if used is None else used
    secs, notes = find_sections(html_to_lines(html))
    k = form.startswith("10-K")
    where = {"mdna": secs.get("7" if k else "2"), "mrisk": secs.get("7A" if k else "3"),
             "business": secs.get("1") if k else None, "risks": secs.get("1A") if k else None,
             "debt": pick_note(notes, DEBT_RE), "segments": pick_note(notes, SEG_RE),
             "concentration": pick_note(notes, CONC_RE)}
    out = []
    for tid, places, kws, supports, n in TOPICS:
        paras, labels = [], []
        for pl in places:
            if where.get(pl):
                got = [p for p in pick_paragraphs(where[pl][1], kws, n) if p not in used and p not in paras]
                if got:
                    labels.append(where[pl][0])     # list only the sections that contributed
                    paras += got
        if not paras:
            continue
        text, kept = "", []
        for p in paras[:n]:
            p = _cut(p)
            if len(text) + len(p) + 2 > EXCERPT_MAX or len(text) + len(p) > budget:
                break
            text += ("\n\n" if text else "") + p
            kept.append(p)
        if not text:
            continue
        used.update(paras[:len(kept)])
        budget -= len(text)
        out.append({"id": f"{tid}_{form.lower()}", "topic": tid, "supports": supports, "form": form,
                    "period_end": period_end, "section": " / ".join(dict.fromkeys(labels)), "filing": url, "text": text})
    return out


def collect_filing_text():
    """Latest 10-K, plus the latest 10-Q if it is newer, fetched from EDGAR and reduced to excerpts."""
    H = {"User-Agent": os.getenv("SEC_USER_AGENT", "")}
    cik = CTX["cik"]
    rec = get_json(f"https://data.sec.gov/submissions/CIK{cik}.json", headers=H)["filings"]["recent"]
    rows = [dict(zip(rec, v)) for v in zip(*rec.values())]
    pick_ = {}
    for r in sorted(rows, key=lambda r: r["filingDate"], reverse=True):
        if r["form"] in ("10-K", "10-Q") and r["form"] not in pick_ and r.get("primaryDocument"):
            pick_[r["form"]] = r
    if "10-K" in pick_ and "10-Q" in pick_ and pick_["10-Q"]["filingDate"] < pick_["10-K"]["filingDate"]:
        del pick_["10-Q"]
    used, out, budget = set(), [], TEXT_BUDGET
    for form in ("10-Q", "10-K"):             # current period first, so its paragraphs are kept in a tie
        r = pick_.get(form)
        if not r:
            continue
        time.sleep(0.2)
        url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{r['accessionNumber'].replace('-', '')}/{r['primaryDocument']}"
        resp = requests.get(url, headers=H, timeout=60)
        resp.raise_for_status()
        ex = extract_excerpts(resp.text, form, r.get("reportDate") or r["filingDate"], url, used, budget)
        budget -= sum(len(e["text"]) for e in ex)
        out += ex
    return sorted(out, key=lambda e: (e["topic"], e["form"]))


# --------------------------------------------------------------------------- JSON output
# Raw SEC line items, in output order. (name, tags in priority order, kind, unit)
# One tag per item per company: the tag with data at the latest fiscal year end wins; ties go to the
# earlier tag in this list. Values are positive as filed. See README section 9.
_NS = "InterestIncomeExpenseNonoperatingNet"
_PT = "IncomeLossFromContinuingOperationsBeforeIncomeTaxes"
SEC_ITEMS = [
    ("revenue", TAGS_REV, "flow"),
    ("cogs", ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"], "flow"),
    ("gross_profit", ["GrossProfit"], "flow"),
    ("sga", ["SellingGeneralAndAdministrativeExpense"], "flow"),
    ("operating_income", ["OperatingIncomeLoss"], "flow"),
    ("net_income", ["NetIncomeLoss", "ProfitLoss"], "flow"),
    ("da", ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization",
            "DepreciationAmortizationAndAccretionNet", "Depreciation"], "flow"),
    ("interest_expense", ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt",
                          "InterestAndDebtExpense", "InterestCostsIncurred"], "flow"),
    ("income_tax_expense", ["IncomeTaxExpenseBenefit"], "flow"),
    ("pretax_income", [_PT + "ExtraordinaryItemsNoncontrollingInterest",
                       _PT + "MinorityInterestAndIncomeLossFromEquityMethodInvestments"], "flow"),
    ("net_interest_nonoperating", [_NS, "InterestIncomeExpenseNet"], "flow"),
    ("cfo", ["NetCashProvidedByUsedInOperatingActivities"], "flow"),
    ("capex", ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], "flow"),
    ("interest_paid", ["InterestPaidNet", "InterestPaid"], "flow"),
    ("taxes_paid", ["IncomeTaxesPaidNet", "IncomeTaxesPaid"], "flow"),
    ("dividends", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], "flow"),
    ("buybacks", ["PaymentsForRepurchaseOfCommonStock"], "flow"),
    ("debt_repaid", ["RepaymentsOfDebt", "RepaymentsOfLongTermDebt"], "flow"),
    ("debt_issued", ["ProceedsFromIssuanceOfDebt", "ProceedsFromIssuanceOfLongTermDebt"], "flow"),
    ("cash", ["CashAndCashEquivalentsAtCarryingValue",
              "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], "instant"),
    ("st_investments", ["ShortTermInvestments", "MarketableSecuritiesCurrent",
                        "AvailableForSaleSecuritiesDebtSecuritiesCurrent"], "instant"),
    ("receivables", ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], "instant"),
    ("inventory", ["InventoryNet", "InventoryFinishedGoodsNetOfReserves"], "instant"),
    ("payables", ["AccountsPayableCurrent"], "instant"),
    ("current_assets", ["AssetsCurrent"], "instant"),
    ("current_liabilities", ["LiabilitiesCurrent"], "instant"),
    ("total_assets", ["Assets"], "instant"),
    ("total_liabilities", ["Liabilities"], "instant"),
    ("equity", ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], "instant"),
    ("liabilities_and_equity", ["LiabilitiesAndStockholdersEquity"], "instant"),
    ("ltd_total", ["LongTermDebt"], "instant"),
    ("ltd_noncurrent", ["LongTermDebtNoncurrent"], "instant"),
    ("ltd_current", ["LongTermDebtCurrent"], "instant"),
    ("debt_current", ["DebtCurrent"], "instant"),
    ("short_term_borrowings", ["ShortTermBorrowings", "CommercialPaper"], "instant"),
    ("revolver", ["LineOfCredit"], "instant"),
    ("debt_rate_weighted", ["DebtWeightedAverageInterestRate", "LongTermDebtWeightedAverageInterestRate"], "rate"),
    ("maturity_y1", [MAT + "InNextTwelveMonths"], "fyinstant"),
    ("maturity_y2", [MAT + "InYearTwo"], "fyinstant"),
    ("maturity_y3", [MAT + "InYearThree"], "fyinstant"),
    ("maturity_y4", [MAT + "InYearFour"], "fyinstant"),
    ("maturity_y5", [MAT + "InYearFive"], "fyinstant"),
    ("maturity_after_y5", [MAT + "AfterYearFive"], "fyinstant"),
    ("op_lease_liability", ["OperatingLeaseLiability"], "instant"),
    ("op_lease_liability_current", ["OperatingLeaseLiabilityCurrent"], "instant"),
    ("op_lease_liability_noncurrent", ["OperatingLeaseLiabilityNoncurrent"], "instant"),
    ("op_lease_cost", ["OperatingLeaseCost", "OperatingLeasePayments"], "flow"),
    ("finance_lease_liability", ["FinanceLeaseLiability"], "instant"),
    ("shares_outstanding", ["EntityCommonStockSharesOutstanding"], "dei"),
    ("diluted_shares", ["WeightedAverageNumberOfDilutedSharesOutstanding"], "fyflow_shares"),
]
# Items that carry 3 fiscal years + the most current period (they feed the graphs)
HIST = {"revenue", "gross_profit", "operating_income", "net_income", "da", "cash", "st_investments",
        "ltd_total", "short_term_borrowings"}
UNITS = {"debt_rate_weighted": "fraction", "diluted_shares": "shares", "shares_outstanding": "shares"}


def _has(facts, tag, end, kind, unit="USD"):
    return value_at(facts, [tag], end, kind, unit)[0] is not None


def pick_tag(facts, tags, kind, ends, unit="USD"):
    """Tag with data at the most recent fiscal year end; ties go to the earlier tag in the list."""
    vk = "annual" if kind in ("flow", "fyflow_shares") else "instant"
    for e in ends:  # newest first
        for t in tags:
            if _has(facts, t, e, vk, unit):
                return t
    return None


def _clean(v):
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return int(v) if v == int(v) and abs(v) >= 1000 else v


def build_json():
    facts = CTX.get("facts")
    if not facts:
        raise RuntimeError("EDGAR data is required for the JSON (SEC_USER_AGENT missing or EDGAR failed)")
    tag_rev, rrows = best_rows(facts, TAGS_REV)
    ann = duration_series(rrows, 350, 380)
    fy_ends = sorted({e for (_, e) in ann}, reverse=True)
    fe = fy_ends[0]
    E = max(r["end"] for r in rrows)
    live = E > fe                       # a 10-Q is newer than the last 10-K
    pers = sorted(fy_ends[:3]) + ([E] if live else [])
    last = pers[-1]
    last_basis = "ttm" if live else "fy"

    # ---- raw SEC items
    V, TAGUSED, ROWUSED = {}, {}, {}
    for name, tags, kind in SEC_ITEMS:
        if kind == "dei":
            continue
        unit = "pure" if kind == "rate" else ("shares" if kind == "fyflow_shares" else "USD")
        if kind == "flow" and name == "revenue":
            tags = [tag_rev]
        tag = pick_tag(facts, tags, kind, fy_ends, unit)
        TAGUSED[name] = tag
        V[name] = {}
        if kind in ("fyinstant", "rate", "fyflow_shares"):
            ends = [fe]
        else:
            ends = pers
        for e in ends:
            v = r = None
            if tag:
                if kind == "flow":
                    if live and e == E:
                        v, _, r = ttm_flow(facts, [tag], e)
                    else:
                        v, _, r = value_at(facts, [tag], e, "annual")
                elif kind == "fyflow_shares":
                    v, _, r = value_at(facts, [tag], e, "annual", "shares")
                else:
                    v, _, r = value_at(facts, [tag], e, "instant", "pure" if kind == "rate" else "USD")
            if kind == "rate" and v is not None and v >= 1:
                v = v / 100            # some filers tag 4.1 instead of 0.041
            V[name][e] = v
            ROWUSED[(name, e)] = r
    # fill SEC gaps from the other sources (FMP, then yfinance); remember where each value came from
    SRC = {n: {e: "SEC" for e in V[n]} for n in V}
    for name, tags, kind in SEC_ITEMS:
        if kind not in ("flow", "instant"):
            continue
        for e in pers:
            if V[name][e] is None:
                v, prov = fallback_value(name, e, kind == "flow", live and e == E)
                if v is not None:
                    V[name][e], SRC[name][e] = v, prov
    # shares outstanding (dei cover-page count, latest filed)
    dei = facts.get("dei", {}).get("EntityCommonStockSharesOutstanding", {}).get("units", {}).get("shares", [])
    dei = [r for r in dei if r.get("form") in FORMS]
    sh = max(dei, key=lambda r: (r["end"], r["filed"])) if dei else None
    shares_end = sh["end"] if sh else last

    def at(name, e=None):
        return V[name].get(e or last)

    out = []

    # inputs behind each derived metric, so its "source" list shows any fallback provider it relied on
    _eb, _debt = ["operating_income", "da"], ["ltd_total", "ltd_noncurrent", "ltd_current", "debt_current", "short_term_borrowings"]
    DI = {"ebitda": _eb, "ebitda_margin": _eb + ["revenue"], "gross_margin": ["gross_profit", "revenue"],
          "operating_margin": ["operating_income", "revenue"], "net_margin": ["net_income", "revenue"],
          "net_debt_to_ebitda": _eb + _debt + ["cash", "st_investments"],
          "current_ratio": ["current_assets", "current_liabilities"],
          "quick_ratio": ["cash", "st_investments", "receivables", "current_liabilities"],
          "total_debt": _debt, "net_debt": _debt + ["cash", "st_investments"],
          "fixed_charge_coverage_ratio": _eb + ["capex", "taxes_paid", "interest_expense", "interest_paid",
                                                "ltd_current", "debt_current"]}

    def entry(name, unit, vals, source=None, typ="direct", **kw):
        if source is None:      # SEC-based entry: SEC first, then any fallback provider whose value was used
            shown = {e for e, _, _ in vals}     # only the periods actually emitted in this entry
            used = {SRC[n][e] for n in ([name] if name in SRC else DI.get(name, [])) for e in SRC.get(n, {})
                    if e in shown and V[n][e] is not None}
            source = ([x for x in ["SEC"] + FALLBACK_ORDER if x in used]) or ["SEC"]
        vl = []
        for e, b, v in vals:
            d = {"period_end": e, "basis": b, "value": _clean(v)}
            if name in SRC and v is not None and SRC[name].get(e) not in (None, "SEC"):
                d["source"] = SRC[name][e]     # this single value came from a fallback provider
            vl.append(d)
        d = {"name": name, "unit": unit, "source": list(source), "type": typ, "values": vl}
        d.update(kw)
        out.append(d)

    def basis_for(kind, e):
        if kind == "flow":
            return "ttm" if (live and e == E) else "fy"
        return "latest" if (live and e == E) or kind == "instant" and e == last else "fy"

    for name, tags, kind in SEC_ITEMS:
        unit = UNITS.get(name, "usd")
        if kind == "dei":
            entry(name, unit, [(shares_end, "latest", sh["val"] if sh else None)])
        elif kind in ("fyinstant", "rate", "fyflow_shares"):
            entry(name, unit, [(fe, "latest" if kind == "rate" else "fy", V[name][fe])])
        elif name in HIST:
            entry(name, unit, [(e, "fy" if not (live and e == E) else basis_for(kind, e), V[name][e]) for e in pers])
        else:
            entry(name, unit, [(last, "ttm" if kind == "flow" and live else ("fy" if kind == "flow" else "latest"), V[name][last])])

    # ---- derived from the line items
    def sub(*xs):
        return None if any(x is None for x in xs) else sum(xs)

    def ebitda_at(e):
        return sub(V["operating_income"][e], V["da"][e])

    def debt_at(e):
        t = V["ltd_total"][e]
        if t is None and V["ltd_noncurrent"][e] is not None:
            cur = V["ltd_current"][e] if V["ltd_current"][e] is not None else (V["debt_current"][e] or 0)
            t = V["ltd_noncurrent"][e] + cur
        return None if t is None else t + (V["short_term_borrowings"][e] or 0)

    def netdebt_at(e):
        d, c = debt_at(e), V["cash"][e]
        return None if d is None or c is None else d - c - (V["st_investments"][e] or 0)

    ser = lambda f: [(e, last_basis if e == last else "fy", f(e)) for e in pers]
    rd = lambda x, n=4: None if x is None else round(x, n)
    entry("ebitda", "usd", ser(ebitda_at), typ="derived")
    entry("ebitda_margin", "fraction", ser(lambda e: rd(div(ebitda_at(e), V["revenue"][e]))), typ="derived")
    entry("gross_margin", "fraction", ser(lambda e: rd(div(V["gross_profit"][e], V["revenue"][e]))), typ="derived")
    entry("operating_margin", "fraction", ser(lambda e: rd(div(V["operating_income"][e], V["revenue"][e]))), typ="derived")
    entry("net_margin", "fraction", ser(lambda e: rd(div(V["net_income"][e], V["revenue"][e]))), typ="derived")
    entry("net_debt_to_ebitda", "x", ser(lambda e: rd(div(netdebt_at(e), ebitda_at(e)), 2)), typ="derived")
    cl = at("current_liabilities")
    entry("current_ratio", "x", [(last, "latest", rd(div(at("current_assets"), cl), 2))], typ="derived")
    q = sub(at("cash"), at("receivables")) if at("cash") is not None and at("receivables") is not None else None
    entry("quick_ratio", "x", [(last, "latest", rd(div(None if q is None else q + (at("st_investments") or 0), cl), 2))], typ="derived")
    entry("total_debt", "usd", [(last, "latest", debt_at(last))], typ="derived")
    entry("net_debt", "usd", [(last, "latest", netdebt_at(last))], typ="derived")
    eb = ebitda_at(last)
    interest = V["interest_expense"][last] if V["interest_expense"][last] is not None else V["interest_paid"][last]
    principal = V["maturity_y1"][fe]
    if principal is None:
        principal = V["ltd_current"][last] if V["ltd_current"][last] is not None else V["debt_current"][last]
    fccr = None
    if None not in (eb, V["capex"][last], V["taxes_paid"][last], interest, principal):
        fccr = rd(div(eb - V["capex"][last] - V["taxes_paid"][last], interest + principal), 2)
    entry("fixed_charge_coverage_ratio", "x", [(last, last_basis, fccr)], typ="derived")

    # quarterly revenue
    ql = quarterly_with_q4(rrows)
    qs = ql[-12:]
    entry("revenue_quarterly", "usd", [(x["end"], "quarter", x["val"]) for x in qs], typ="derived" if any(x["derived"] for x in qs) else "direct")
    yoy = []
    for x in qs[-8:]:
        pr = next((y for y in ql if 350 <= ddays(y["end"], x["end"]) <= 380), None)
        yoy.append((x["end"], "quarter", rd(growth(x["val"], pr["val"]) if pr else None)))
    entry("revenue_yoy", "fraction", yoy, typ="derived")
    lat = ql[-1] if ql else None
    entry("revenue_qoq", "fraction", [(lat["end"] if lat else last, "quarter", rd(growth(lat["val"], ql[-2]["val"]) if lat and len(ql) > 1 else None))], typ="derived")
    entry("revenue_latest_quarter", "usd", [(lat["end"] if lat else last, "quarter", lat["val"] if lat else None)],
          typ="derived" if lat and lat["derived"] else "direct")
    base = next((r for (s, e), r in ann.items() if 1080 <= ddays(e, fe) <= 1110), None)
    cagr = None if not base or not V["revenue"][fe] or base["val"] <= 0 else (V["revenue"][fe] / base["val"]) ** (1 / 3) - 1
    entry("revenue_cagr_3y", "fraction", [(fe, "fy", rd(cagr))], typ="derived")
    arow = next(r for (s, e), r in ann.items() if e == fe)
    fyq = [x for x in ql if arow["start"] < x["end"] <= fe]
    seas = None
    if len(fyq) == 4:
        seas = max(x["val"] for x in fyq) / sum(x["val"] for x in fyq)
    entry("seasonality_peak_quarter_share", "fraction", [(fe, "fy", rd(seas, 2))], typ="derived")
    entry("floating_rate_share", "fraction", [(fe, "fy", None)], typ="derived")
    entry("customer_concentration", "fraction", [(fe, "fy", None)], typ="derived")

    # ---- non-SEC metrics: median of sources that report the same thing
    today = date.today().isoformat()
    px_end = CTX.get("px_end", today)

    def combine(mid, unit, rows, period_end, basis, keep=lambda v: True, **kw):
        by = {}
        for src, val, note in rows:
            raw = getattr(val, "raw", None)
            if raw is None or not keep(str(val)) or _clean(raw) is None:
                continue
            k = kind_for(METRIC_OF[mid], src, val)
            c = by.get(src)
            if c is None or (c[0] == "derived" and k == "direct"):
                by[src] = (k, float(raw))
        if not by:
            entry(mid, unit, [(period_end, basis, None)], source=(), typ=None, disagreement_pct=None, **kw)
            return
        nums = [v for _, v in by.values()]
        med = statistics.median(nums)
        spread = round((max(nums) - min(nums)) / abs(med) * 100, 1) if len(nums) > 1 and med else None
        types = {k for k, _ in by.values()}
        entry(mid, unit, [(period_end, basis, round(med) if unit == "usd" else round(med, 4))],
              source=list(by), typ=types.pop() if len(types) == 1 else "mixed", disagreement_pct=spread, **kw)

    METRIC_OF = {"market_cap": "Market cap", "ev_to_ebitda": "EV/EBITDA", "beta": "Beta",
                 "annualized_volatility": "Annualized volatility", "max_drawdown_1y": "Max drawdown (1y)",
                 "vix": "VIX", "high_yield_spread": "High-yield spread", "yield_curve_10y_2y": "10Y-2Y yield curve",
                 "revenue_by_segment": "Revenue by segment", "revenue_by_region": "Revenue by region"}
    R = lambda mid: ROWS[METRIC_OF[mid]]
    combine("market_cap", "usd", R("market_cap"), today, "live")
    combine("ev_to_ebitda", "x", R("ev_to_ebitda"), last, "ttm" if live else "fy")
    # beta: only the 1-year calculation vs SPY; Yahoo/Finnhub betas use a different window (5y monthly)
    combine("beta", "ratio", R("beta"), px_end, "1y", keep=lambda t: t.endswith("(calc)"))
    combine("annualized_volatility", "fraction", R("annualized_volatility"), px_end, "1y")
    combine("max_drawdown_1y", "fraction", R("max_drawdown_1y"), px_end, "1y")
    for mid, unit in (("vix", "index_points"), ("high_yield_spread", "percent_points"), ("yield_curve_10y_2y", "percent_points")):
        combine(mid, unit, R(mid), FRED_DATES.get(METRIC_OF[mid], today), "latest")
    for mid in ("revenue_by_segment", "revenue_by_region"):
        b = BREAKDOWN.get(METRIC_OF[mid])
        entry(mid, "fraction", [(str(b["date"])[:10] if b and b["date"] and len(str(b["date"])) >= 10 else fe, "fy", None)],
              source=["FMP"] if b else (), typ="derived" if b else None, disagreement_pct=None,
              **({"breakdown": [{"name": i["name"], "value": _clean(i["value"]), "share": round(i["share"], 4)} for i in b["items"]]} if b else {}))

    # ---- filings map: period end -> SEC filing folder
    filings = {}
    cik = int(CTX["cik"])
    for e in pers:   # the filing that first reported the period (later filings repeat it as a comparative)
        cand = [r for r in rrows if r["end"] == e and "start" in r]
        r = min(cand, key=lambda r: r["filed"]) if cand else None
        if r:
            filings[e] = f"https://www.sec.gov/Archives/edgar/data/{cik}/{r['accn'].replace('-', '')}/"
    return {"company": {"name": CTX["name"], "ticker": TICKER, "cik": CTX["cik"], "as_of": last},
            "filings": filings, "metrics": out}, TAGUSED


def write_json(doc, path):
    one = lambda o: json.dumps(o, separators=(", ", ": "))
    L = ["{", f'  "company": {one(doc["company"])},', f'  "filings": {one(doc["filings"])},', '  "metrics": [']
    n = len(doc["metrics"])
    for i, e in enumerate(doc["metrics"]):
        L.append("    " + one(e) + ("," if i < n - 1 else ""))
    ft = doc.get("filing_text")
    if ft:
        L += ["  ],", '  "filing_text": [']
        L += ["    " + one(e) + ("," if i < len(ft) - 1 else "") for i, e in enumerate(ft)]
        L += ["  ]", "}"]
    else:
        L += ["  ]", "}"]
    Path(path).write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    print(f"Collecting metrics for {TICKER} ...")
    run("EDGAR", collect_edgar, "SEC_USER_AGENT")
    run("FMP", collect_fmp, "FMP_API_KEY")
    run("Finnhub", collect_finnhub, "FINNHUB_API_KEY")
    run("yfinance", collect_yfinance)
    run("FRED", collect_fred, "FRED_API_KEY")
    run("NewsAPI", collect_newsapi, "NEWSAPI_KEY")

    print(f"\nCompany: {CTX['name']} ({TICKER})  Sector: {CTX['sector'] or 'unknown'}")
    if "financ" in CTX["sector"].lower():
        print("WARNING: bank/insurer. EBITDA, leverage, FCCR and margins are not meaningful here; "
              "the proposal calls for different metrics for these companies.")
    print_table()

    if HEADLINES:
        print("\nREPUTATION HEADLINES (keyword-tagged; '-' = no risk keyword)")
        print(f"{'Date':<11} | {'Source':<8} | {'Tag':<12} | Headline / URL")
        for d, s, tag, title, url in sorted(HEADLINES, key=lambda h: h[0], reverse=True)[:20]:
            print(f"{d:<11} | {s:<8} | {tag:<12} | {trunc(title, 80)}\n{'':<37}{url}")

    if ISSUES:
        print("\nISSUES (blocked/paywalled endpoints, missing fields)")
        for s, what, err in ISSUES:
            print(f"  [{s}] {what}: {err}")

    print("\nSOURCE STATUS")
    for k, v in STATUS.items():
        print(f"  {k:<9} {v}")

    if ARGS.json or ARGS.out:
        path = ARGS.out or f"output_{TICKER}.json"
        try:
            doc, used = build_json()
            try:
                ft = collect_filing_text()
                if ft:
                    doc["filing_text"] = ft
                print(f"filing text: {len(ft)} excerpts ({', '.join(sorted({e['topic'] for e in ft})) or 'none'})")
            except Exception as e:
                print(f"filing text skipped: {type(e).__name__}: {str(e)[:120]}")
            write_json(doc, path)
            nulls = [e["name"] for e in doc["metrics"] if all(v["value"] is None for v in e["values"]) and e["name"] not in ("floating_rate_share", "customer_concentration")]
            print(f"\nJSON written to {path}: {len(doc['metrics'])} metrics; all-null: {', '.join(nulls) or 'none'}")
        except Exception as e:
            print(f"\nJSON NOT written: {type(e).__name__}: {e}")