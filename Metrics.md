# Company Memo Data Check

This script pulls every metric in the AI Pitch Deck proposal (EBITDA, growth and valuation, revenue QoQ and YoY, margins, liquidity, fixed charge coverage, leverage, debt, reputation, company exposure, market stability) from each free source that can supply it, and prints them in one table. It is a data-validation tool, not the memo itself. Its purpose is to show, for each number, which source produced it, whether the source returned it as-is or we calculated it, and exactly how.

Written for a credit or equity analyst. Every formula below is the formula the code runs.

Last updated: 2026-11-02

---

## 1. Running it

```
pip install -r requirements.txt
cp .env.example .env          # then fill in your keys
python source_check.py AAPL           # trailing twelve months (default)
python source_check.py AAPL fy        # latest fiscal year instead
```

Keys go in `.env` next to the script. A blank key skips that source and the rest still run.

| Variable | What it is | Where to get it |
|---|---|---|
| `SEC_USER_AGENT` | Not a key. Your name and an email, e.g. `Jane Doe jane@firm.com`. SEC rejects requests without one. | No signup |
| `FMP_API_KEY` | Financial Modeling Prep | financialmodelingprep.com |
| `FINNHUB_API_KEY` | Finnhub | finnhub.io/register |
| `NEWSAPI_KEY` | NewsAPI | newsapi.org/register |
| `FRED_API_KEY` | St. Louis Fed | fredaccount.stlouisfed.org (API Keys) |

yfinance needs no key. Free-tier limits change, so check each provider's pricing page.

---

## 2. Reading the output

Each row is one metric from one source, so a metric with several sources shows several rows (blank metric name means "same metric as above").

| Column | Meaning |
|---|---|
| Metric | Name from the proposal. Metrics no source returned still print as "no data". |
| Source | EDGAR, FMP, Finnhub, yfinance, FRED, NewsAPI |
| Value | The number, formatted. `n/a` means the source did not provide it. |
| Type | **direct**: the source returned this exact field. **derived**: this script calculated it from other values. |
| Note | For derived rows, the formula and the period. For EDGAR rows, the XBRL tag, period end date, filing date and accession number, so the figure can be traced to the filing. |

Below the table: a reputation headline table, an ISSUES section (paywalled endpoints, missing fields, rate limits) and a SOURCE STATUS summary.

Banks and insurers: if the sector contains "financ", the script prints a warning. EBITDA, leverage and fixed charge coverage are not meaningful for them and the proposal calls for different metrics. Those are not built yet.

---

## 3. Periods: TTM versus fiscal year

EDGAR rows follow the period you choose.

**TTM (default).** Income and cash flow items are trailing twelve months to the latest reported period end E:

`TTM = latest full fiscal year + current year-to-date - prior-year same year-to-date`

If the latest filing is a 10-K, TTM is simply that fiscal year. Balance sheet items (cash, debt, current assets and liabilities, receivables) are taken at E, the latest quarter end. If a balance sheet tag is not reported at E (some tags only appear in 10-Ks), the script uses the fiscal-year value and says so in the Note column ("FY values used for: ...").

**FY.** Everything comes from the latest 10-K.

Always fiscal-year based regardless of the mode: the 3-year revenue CAGR, the leverage trend, the debt maturity schedule, the weighted average interest rate and the seasonality share. These come from 10-K disclosures.

Why this matters when comparing sources: Yahoo's EBITDA and margins are TTM. If EDGAR is run in `fy` mode the two will differ by up to a year of growth.

---

## 4. How each metric is calculated

### 4.1 EBITDA

| Source | How |
|---|---|
| EDGAR (derived) | `OperatingIncomeLoss + D&A`. D&A is the first available of `DepreciationDepletionAndAmortization`, `DepreciationAndAmortization`, `DepreciationAmortizationAndAccretionNet`. |
| FMP (direct) | `ebitda` from the latest **annual** income statement. Note this is fiscal year, not TTM. |
| yfinance (direct) | Yahoo's `ebitda` field (TTM). |

The EDGAR figure is unadjusted: no stock-based compensation add-back, no one-off items, no lease adjustment. The XBRL filing has no EBITDA tag, so it has to be built. Aggregators may apply their own adjustments and will not match exactly.

EBITDA margin: EDGAR = EBITDA / revenue for the same period. FMP uses `ebitdaMarginTTM`. yfinance uses `ebitdaMargins`.

### 4.2 Growth and valuation

| Metric | EDGAR | Others |
|---|---|---|
| 3-yr revenue growth | `(FY revenue / FY revenue three years earlier)^(1/3) - 1`, from 10-K annual revenue | FMP and yfinance: same formula on their annual statements (derived). Finnhub: `revenueGrowth3Y` (direct). |
| Market cap | Not available (no market data) | FMP `marketCap` from profile, Finnhub `marketCapitalization` (reported in $M, script converts), yfinance `marketCap`. All live. |
| EV/EBITDA | Not available | FMP `evToEBITDATTM` (key-metrics-ttm), yfinance `enterpriseToEbitda`. Both direct, TTM. Definitions of EV differ by provider (treatment of leases, minority interest, investments). |

### 4.3 Revenue QoQ and YoY

EDGAR builds discrete quarters from 10-Q three-month values. 10-Ks only report the full year, so the fourth quarter is derived:

`Q4 = 10-K annual revenue - (Q1 + Q2 + Q3 from the three 10-Qs)`

This is only done when exactly three 10-Q quarters sit inside that fiscal year. The Note column says "Q4 derived" when the latest quarter was built this way.

- `QoQ = latest quarter / prior quarter - 1`
- `YoY = latest quarter / quarter ending 350 to 380 days earlier - 1`

Revenue tag priority: `RevenueFromContractWithCustomerExcludingAssessedTax`, `Revenues`, `SalesRevenueNet`, `RevenueFromContractWithCustomerIncludingAssessedTax`. The tag with the most recent data wins, since companies switch tags over time.

FMP and yfinance compute QoQ and YoY from their quarterly income statements the same way (derived). yfinance keeps only about five quarters, so YoY works but longer history does not. yfinance also returns its own `revenueGrowth` (latest quarter YoY), shown as a separate direct row marked "(Yahoo)". Finnhub returns `revenueGrowthQuarterlyYoy` (direct).

### 4.4 Profit margins

| Margin | EDGAR | FMP | Finnhub | yfinance |
|---|---|---|---|---|
| Gross | `GrossProfit / revenue` | `grossProfitMarginTTM` | `grossMarginTTM` | `grossMargins` |
| Operating | `OperatingIncomeLoss / revenue` | `operatingProfitMarginTTM` | `operatingMarginTTM` | `operatingMargins` |
| Net | `NetIncomeLoss / revenue` | `netProfitMarginTTM` | `netProfitMarginTTM` | `profitMargins` |

EDGAR net income is `NetIncomeLoss` (attributable to the parent), falling back to `ProfitLoss` (including non-controlling interests). If a company does not report gross profit (many banks, some services firms), the gross margin shows n/a.

### 4.5 Liquidity

| Metric | EDGAR formula |
|---|---|
| Current ratio | `AssetsCurrent / LiabilitiesCurrent` |
| Quick ratio | `(cash and equivalents + short-term investments + receivables) / current liabilities` |
| Cash on hand | `CashAndCashEquivalentsAtCarryingValue` (direct). Excludes short-term investments; the Note shows their size. |

Quick ratio tags: cash `CashAndCashEquivalentsAtCarryingValue`; short-term investments `ShortTermInvestments`, `MarketableSecuritiesCurrent` or `AvailableForSaleSecuritiesDebtSecuritiesCurrent`; receivables `AccountsReceivableNetCurrent` or `ReceivablesNetCurrent`. Cash and receivables must both be present, otherwise n/a. Short-term investments count as zero if the company has none tagged.

Known understatement: receivable types outside the two tags (for example vendor or non-trade receivables, which Apple reports separately) are left out. This makes the EDGAR quick ratio lower than Yahoo's or Finnhub's for such companies. Treat it as a conservative quick ratio.

Other sources: FMP `currentRatioTTM`, `quickRatioTTM` and balance sheet `cashAndCashEquivalents` (annual). Finnhub `currentRatioQuarterly`, `quickRatioQuarterly`. yfinance `currentRatio`, `quickRatio`, `totalCash`. Yahoo's `totalCash` includes short-term investments, so it will be larger than EDGAR's cash and equivalents.

### 4.6 Debt

| Metric | EDGAR |
|---|---|
| Total debt | `LongTermDebt` (includes the current portion). If absent: `LongTermDebtNoncurrent` plus the current portion (`LongTermDebtCurrent`, else `DebtCurrent`). Then plus `CommercialPaper` or `ShortTermBorrowings`. **Lease liabilities are excluded.** |
| Net debt | `total debt - cash and equivalents - short-term investments` |
| Average interest rate | `DebtWeightedAverageInterestRate` or `LongTermDebtWeightedAverageInterestRate`, direct. n/a if the company does not tag it. |
| Debt maturity schedule | Five yearly buckets and "after five years" from `LongTermDebtMaturitiesRepaymentsOfPrincipalIn...` tags in the latest 10-K. The largest bucket is named in the Value column. |
| Floating-rate share | Not available from structured data. Needs the 10-K debt footnote parsed. Shows n/a. |

FMP returns `totalDebt` and `netDebt` from the latest annual balance sheet (direct). yfinance returns `totalDebt` (direct, may include leases) and net debt is computed as `totalDebt - totalCash`.

Net debt in this tool subtracts short-term investments as well as cash. Some credit agreements subtract cash only, or cap the amount that can be netted. Use the covenant definition for real credit work.

### 4.7 Leverage ratio

`Net debt / EBITDA`, using the net debt and EBITDA defined above and the same period.

- EDGAR: derived. The trend row repeats the calculation at each of the last four fiscal year ends (always fiscal year, oldest to newest).
- FMP: `netDebtToEBITDATTM`, direct.
- yfinance: derived from Yahoo's `totalDebt`, `totalCash` and `ebitda`.

Different answers across sources are expected. The proposal flags the two big drivers: whether leases are debt, and whether EBITDA is adjusted. Here, EDGAR excludes leases and uses unadjusted EBITDA.

### 4.8 Fixed charge coverage ratio (EDGAR only)

```
FCCR = (EBITDA - capex - cash taxes) / (interest + scheduled principal due in the next 12 months)
```

Marked PASS if 1.25x or higher, otherwise FAIL.

| Input | Tag used |
|---|---|
| Capex | `PaymentsToAcquirePropertyPlantAndEquipment`, else `PaymentsToAcquireProductiveAssets` |
| Cash taxes | `IncomeTaxesPaidNet`, else `IncomeTaxesPaid` |
| Interest | `InterestExpense`, `InterestExpenseNonoperating`, `InterestExpenseDebt`, `InterestAndDebtExpense`, then as a fallback cash interest paid (`InterestPaidNet`, `InterestPaid`) |
| Principal | `LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths`. If untagged, the current portion of debt is used as an **estimate**, and the Note says "principal ESTIMATED". |

What to watch:

- This is a debt-service version. Operating lease rent is not in the denominator. A lease-adjusted version (EBITDAR over interest plus rent plus principal) would be lower for lease-heavy companies.
- If capex or cash taxes are missing, they are treated as zero and listed in the Note ("missing: ..."), which overstates the ratio. If interest or principal is missing the result is n/a.
- Covenant definitions vary by agreement. Treat this as a screen, not a compliance calculation.
- FMP does not offer a fixed charge coverage field. Its closest fields are `interestCoverageRatioTTM` and `debtServiceCoverageRatioTTM`, which are different ratios, so they are not shown.

### 4.9 Company exposure

| Metric | Source | How |
|---|---|---|
| Seasonality (peak quarter share) | EDGAR, derived | Largest quarter's revenue divided by the latest fiscal year's total. Needs all four quarters of that year. |
| Revenue by segment | FMP, derived | Product segmentation endpoint. Each segment's share is its revenue divided by the sum of all segments. Top three shown. |
| Revenue by region | FMP, derived | Same method on the geographic segmentation endpoint. |
| Customer concentration | Not built | Customer percentages (for example "Customer A was 12% of revenue") sit in the 10-K text, not in structured data. Shows n/a. |

Segment and region need an FMP key, and may be restricted on the free plan.

### 4.10 Market stability

| Metric | How |
|---|---|
| Beta (calc) | `covariance(stock daily returns, SPY daily returns) / variance(SPY daily returns)`, last 1 year, adjusted closes |
| Beta (Yahoo) | Yahoo's `beta` field. Yahoo uses a 5-year monthly window, so it will differ from the 1-year figure. Finnhub also returns a `beta` field. |
| Annualized volatility | `standard deviation of daily returns x sqrt(252)`, last 1 year |
| Max drawdown (1y) | `minimum of (price / running peak price - 1)` over the last year |
| VIX | FRED `VIXCLS`, latest non-missing value |
| High-yield spread | FRED `BAMLH0A0HYM2` (ICE BofA US High Yield option-adjusted spread), latest value, in percent |
| 10Y-2Y yield curve | FRED `T10Y2Y`, latest value, in percent. Negative means inverted. |

The first three are for the company; the FRED rows describe the market backdrop and are identical for every ticker.

### 4.11 Reputation

NewsAPI returns recent news for the company name. The script:

1. Searches article titles from the last 30 days, in English, for the company name (legal suffixes such as Inc and Corp stripped).
2. Keeps only headlines containing the first word of the company name.
3. Tags each headline by keyword: Legal (lawsuit, class action, settlement, antitrust), Regulatory (investigation, probe, subpoena, fined), Fraud (fraud, scandal, misconduct, whistleblower), Distress (bankruptcy, default, downgrade, layoffs, going concern, restructuring), Cyber/Safety (breach, hack, recall, cyberattack).
4. Sets the flag from the number of tagged headlines: 0 is Low, 1 to 2 is Medium, 3 or more is High.

**Limits to understand:** this is keyword matching, not judgment. "Apple sues supplier" gets a Legal tag although it is not a risk to Apple, and a serious story with none of the keywords gets no tag. The flag is a placeholder until a language-model step reads and classifies the headlines. NewsAPI's free tier is delayed 24 hours, only reaches back about a month, is capped at 100 requests per day, and is licensed for development only. There is no tone score, since that came from GDELT.

---

## 5. Why sources disagree

Differences between EDGAR and an aggregator are normal. In rough order of how often they cause it:

1. **Period.** TTM versus fiscal year, or a quarter-end balance sheet versus a year-end one.
2. **Cash definition.** Cash and equivalents versus cash plus short-term investments.
3. **Debt definition.** Leases in or out, commercial paper in or out, face value versus carrying value.
4. **EBITDA definition.** Reported operating income plus D&A versus adjusted figures.
5. **Rounding and restatements.** EDGAR values are as filed. The script takes the most recently filed value for each period, which picks up restatements.

---

## 6. Data sources

| Source | Used for | Access | Main limits |
|---|---|---|---|
| SEC EDGAR (`data.sec.gov` company facts) | Raw statement line items, filing citations | Free, no key, needs `SEC_USER_AGENT` | US filers only, about 10 requests per second, tags vary by company, no market data |
| FMP | Market cap, EV/EBITDA, ratios, statements, segments | Free key | Free tier about 250 calls per day, some endpoints paid |
| Finnhub | Pre-computed ratios, margins, growth, beta | Free key | Some fields premium, coverage uneven by ticker |
| yfinance | Cross-check on nearly everything, price history | `pip`, no key | Unofficial Yahoo scraper, can break or rate-limit, gray-area terms for commercial use |
| FRED | VIX, credit spread, yield curve | Free key | Macro only |
| NewsAPI | Reputation headlines and flag | Free key | 24-hour delay, about 1 month of history, 100 requests per day, development use only |

**Field-name verification.** FMP ratio and key-metric field names for margins, quick ratio, current ratio, EBITDA margin and EV multiples were checked against FMP's published documentation. The FMP income statement, balance sheet, profile and segmentation field names, and all Finnhub field names, are written from experience and were not confirmed against current docs (those doc pages could not be read). If one of those rows shows n/a while the company clearly has data, a renamed field is the likely cause.

---

## 7. Known gaps

- Floating-rate share and customer concentration need 10-K footnote parsing.
- Segment and region revenue need an FMP key and a plan that includes those endpoints.
- Banks and insurers need a separate metric set (the script only warns).
- The reputation flag is keyword-based.
- Lease-adjusted leverage and FCCR are not calculated.
- EDGAR covers US filers only.
- The script has been tested end to end for EDGAR and yfinance on one ticker (AAPL). FMP, Finnhub, FRED and NewsAPI have not yet been run against live data.

---

## 8. Change log

| Date | Change |
|---|---|
| 2026-11-02 | First version. All sources, one combined table, Type column (direct or derived), Note column with filing citations. |
| 2026-11-02 | Keys moved to a `.env` file. |
| 2026-11-02 | EDGAR now defaults to TTM (flows) with the latest quarter-end balance sheet; `fy` mode kept. |
| 2026-11-02 | EDGAR net debt now subtracts short-term investments as well as cash. |
| 2026-11-02 | FCCR: added cash interest paid as a fallback for companies that no longer tag interest expense. FMP removed as a FCCR source (the field does not exist). |
| 2026-11-02 | FMP EBITDA margin and yfinance revenue YoY now use the source's own field where one exists. |
| 2026-11-02 | GDELT retries on rate limiting. |
| 2026-11-02 | GDELT removed (it was returning rate-limit errors). NewsAPI is now the only reputation source, searching titles over the last 30 days. The tone score went with GDELT. |