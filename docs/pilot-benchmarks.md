# Manual FY2026 pilot benchmarks

These are the independent check figures for the fixed design previews. Amounts are **USD millions** unless stated. They use annual filings and are deliberately dated; a generated memo may include later quarters. Compare the calculator's FY2026 line and same-date balance-sheet items to these values, then check newer periods separately.

## Walmart (FY ended January 31, 2026)

Source: [Walmart FY2026 Form 10-K](https://www.sec.gov/Archives/edgar/data/104169/000010416926000055/wmt-20260131.htm), filed March 13, 2026. The headline revenue metric uses **total revenues**, including membership and other income. Gross margin uses **net sales** because Walmart defines gross profit as net sales less cost of sales.

| Input / calculation | FY2024 | FY2025 | FY2026 |
| --- | ---: | ---: | ---: |
| Total revenues | 648,125 | 680,985 | 713,163 |
| Net sales (gross-margin base) | 642,637 | 674,538 | 706,413 |
| Cost of sales | 490,142 | 511,753 | 535,395 |
| Gross profit = net sales − cost of sales | 152,495 | 162,785 | 171,018 |
| Gross margin / net sales | 23.730% | 24.133% | 24.209% |
| Operating income | 27,012 | 29,348 | 29,825 |
| Depreciation and amortization | 11,853 | 12,973 | 14,203 |
| Estimated EBITDA = operating income + D&A | 38,865 | 42,321 | 44,028 |

FY2026 revenue growth = `713,163 / 680,985 − 1` = **4.7252%**, displayed 4.7%. FY2026 estimated EBITDA margin = `44,028 / 713,163` = **6.1736%**, displayed 6.2%.

At January 31, 2026: cash and equivalents **10,727**; short-term borrowings **6,596**; current long-term debt **3,542**; noncurrent long-term debt **34,624**. Included debt = `6,596 + 3,542 + 34,624` = **44,762**. Same-date FY EBITDA leverage = `44,762 / 44,028` = **1.0167×**, displayed 1.02×. Lease obligations are excluded. About **3,900** of reported cash may not be freely transferable to the United States, as disclosed in the filing.

The 10-K's annual long-term debt maturities are **3,542 / 3,237 / 3,389 / 2,143 / 2,600 / 23,255** for FY2027–FY2031 / thereafter, totaling **38,166**. The schedule excludes the **6,596** short-term borrowings in the broader debt metric. The filing does not assign a complete senior/junior split to each maturity year, so the chart labels these buckets unclassified.

## Microsoft (FY ended June 30, 2026)

Sources: [Microsoft FY2026 Form 10-K](https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm), filed July 29, 2026, and the [FY2026 Q4 earnings release](https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast) for independently visible statement lines and commentary.

| Input / calculation | FY2024 | FY2025 | FY2026 |
| --- | ---: | ---: | ---: |
| Total revenue | 245,122 | 281,724 | 331,839 |
| Total cost of revenue | 74,114 | 87,831 | 106,374 |
| Gross profit (called “gross margin” in dollar terms in the filing) | 171,008 | 193,893 | 225,465 |
| Gross margin / total revenue | 69.764% | 68.824% | 67.944% |
| Revenue growth | — | 14.9321% | 17.7887% |

FY2026 revenue growth = `331,839 / 281,724 − 1` = **17.7887%**, displayed 17.8%. At June 30, 2026, cash and equivalents were **20,935**, current portion of long-term debt was **9,227**, and noncurrent long-term debt was **31,067**. The long-term debt subtotal = `9,227 + 31,067` = **40,294**. The filing's cash-flow line combines “depreciation, amortization, and other,” so this benchmark leaves **EBITDA, EBITDA margin, and leverage unavailable** pending a separately verified D&A input. Fixed charge coverage is unavailable for both pilots by design.

Microsoft's annual maturity table is **9,250 / 0 / 2,001 / 0 / 500 / 34,385** for FY2027–FY2031 / thereafter. It totals **46,136 face value**. The debt note identifies the obligations as senior unsecured. It reconciles to **40,294 carrying debt** after **1,081** unamortized discount and issuance costs, **11** hedge adjustments, and **4,750** debt-exchange premium: `46,136 − 1,081 − 11 − 4,750 = 40,294`. The chart and debt metric therefore use different, labeled bases.

Neither fixed pilot includes a credit rating or Google Trends series. A dated, scoped rating or actual Trends CSV has not been supplied and is shown **N/A**. The pilot narratives remain drafts pending analyst review, even when their sources are public filings.

## Validation procedure

1. Open each preview and compare every displayed available metric with the arithmetic above. Check each source link and claim against the linked filing or release.
2. Generate a fresh memo after importing official SEC companyfacts and submissions JSON, or when SEC API access works. Use `npm run check:pilots` for the full calculation output.
3. Reconcile concept differences, particularly Walmart's `Revenues` versus net sales, and inspect the four-quarter bridge. Do not silently force a benchmark number into an automated result.
4. Print each two-page memo on letter paper. Obtain Ashley's layout and writing feedback before treating the design as final.
