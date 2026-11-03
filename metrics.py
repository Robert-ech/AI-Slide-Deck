"""
Source check + metrics table for the AI Pitch Deck memo.
Pulls every metric in the proposal from every source that can supply it and prints
one table: Metric | Source | Value | Note (note = how it was derived / filing citation).

Usage:  python source_check.py [TICKER]
Keys go in a .env file next to this script (copy .env.example); real env vars also work.
A missing key just skips that source:
  SEC_USER_AGENT  e.g. "Your Name your@email.com"   (EDGAR requires it)
  FMP_API_KEY, FINNHUB_API_KEY, NEWSAPI_KEY, FRED_API_KEY
Install: pip install -r requirements.txt
"""
import os
import re
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

TICKER = (sys.argv[1] if len(sys.argv) > 1 else "AAPL").upper()
PERIOD = (sys.argv[2] if len(sys.argv) > 2 else "ttm").lower()   # "ttm" or "fy"
if PERIOD not in ("ttm", "fy"):
    sys.exit("Second argument must be 'ttm' (default) or 'fy'")
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


def attempt(source, what, fn):
    """Run fn; on failure log an issue (e.g. paywalled endpoint) and return None."""
    try:
        return fn()
    except Exception as e:
        ISSUES.append((source, what, f"{type(e).__name__}: {str(e)[:130]}"))
        return None


def div(a, b):
    return None if a is None or b in (None, 0) else a / b


def growth(a, b):
    r = div(a, b)
    return None if r is None else r - 1


def fm(x):
    if x is None:
        return "n/a"
    s = "-" if x < 0 else ""
    a = abs(x)
    for k, u in ((1e12, "T"), (1e9, "B"), (1e6, "M")):
        if a >= k:
            return f"{s}${a / k:,.2f}{u}"
    return f"{s}${a:,.0f}"


def fx(x):
    return "n/a" if x is None else f"{x:.2f}x"


def fp(x):  # x is a fraction
    return "n/a" if x is None else f"{x * 100:.1f}%"


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
        raise RuntimeError(f"{TICKER} not in EDGAR ticker map (non-US filer?)")
    CTX["name"] = clean_name(m["title"])
    time.sleep(0.2)
    facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{str(m['cik_str']).zfill(10)}.json",
                     headers=H)["facts"]

    _, rrows = best_rows(facts, TAGS_REV)
    ann = duration_series(rrows, 350, 380)
    if not ann:
        raise RuntimeError("no annual revenue found in XBRL facts")
    fy_ends = sorted({e for (_, e) in ann}, reverse=True)
    fe = fy_ends[0]
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
    bs = first(attempt(S, "balance-sheet annual", lambda: call("balance-sheet-statement", period="annual", limit=1)))
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
    add("Beta", S, "n/a" if m.get("beta") is None else f"{m['beta']:.2f}", "/stock/metric")


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
        add("Revenue YoY", S, f"{fp(info['revenueGrowth'])} (Yahoo)", "Yahoo field revenueGrowth (latest quarter YoY)")
    if q:
        add("Revenue (latest quarter)", S, fm(q[0]), "quarterly_income_stmt")
        add("Revenue QoQ", S, fp(growth(q[0], q[1]) if len(q) > 1 else None), "latest vs prior quarter")
        add("Revenue YoY", S, fp(growth(q[0], q[4]) if len(q) > 4 else None),
            "latest vs same quarter last year" + ("" if len(q) > 4 else " (only <5 quarters available)"))
    if len(a) >= 4 and a[3]:
        add("3-yr revenue growth (CAGR)", S, fp((a[0] / a[3]) ** (1 / 3) - 1), "annual income_stmt")

    px = attempt(S, "price history", lambda: yf.download(list(dict.fromkeys([TICKER, "SPY"])), period="1y",
                                                         auto_adjust=True, progress=False)["Close"].dropna())
    if px is not None and TICKER in px:
        r = px.pct_change().dropna()
        if "SPY" in px and TICKER != "SPY":
            add("Beta", S, f"{r[TICKER].cov(r['SPY']) / r['SPY'].var():.2f} (calc)", "1y daily returns vs SPY")
        if info.get("beta") is not None:
            add("Beta", S, f"{info['beta']:.2f} (Yahoo)", "Yahoo field")
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
            add(metric, "FRED", f"{float(obs[0]['value']):.2f}{unit}", f"series {sid}, {obs[0]['date']}")


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
        ISSUES.append((name, "collector", f"{type(e).__name__}: {str(e)[:150]}"))
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