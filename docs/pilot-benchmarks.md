# Manual FY2026 pilot benchmarks

These are the independent check figures for the fixed design previews. Amounts are **USD millions** unless stated. They use annual filings and are deliberately dated; a generated memo may include later quarters. Compare the calculator's FY2026 line and same-date balance-sheet items to these values, then check newer periods separately.

## Walmart (FY ended January 31, 2026)

Source: [Walmart FY2026 Form 10-K](https://www.sec.gov/Archives/edgar/data/104169/000010416926000055/wmt-20260131.htm), filed March 13, 2026. Use **total revenues**, which include membership and other income, rather than the narrower net-sales line.

| Input / calculation | FY2024 | FY2025 | FY2026 |
| --- | ---: | ---: | ---: |
| Total revenues | 648,125 | 680,985 | 713,163 |
| Operating income | 27,012 | 29,348 | 29,825 |
| Depreciation and amortization | 11,853 | 12,973 | 14,203 |
| Estimated EBITDA = operating income + D&A | 38,865 | 42,321 | 44,028 |

FY2026 revenue growth = `713,163 / 680,985 − 1` = **4.7252%**, displayed 4.7%. FY2026 estimated EBITDA margin = `44,028 / 713,163` = **6.1736%**, displayed 6.2%.

At January 31, 2026: cash and equivalents **10,727**; short-term borrowings **6,596**; current long-term debt **3,542**; noncurrent long-term debt **34,624**. Included debt = `6,596 + 3,542 + 34,624` = **44,762**. Same-date FY EBITDA leverage = `44,762 / 44,028` = **1.0167×**, displayed 1.02×. Lease obligations are excluded. About **3,900** of reported cash may not be freely transferable to the United States, as disclosed in the filing.

## Microsoft (FY ended June 30, 2026)

Sources: [Microsoft FY2026 Form 10-K](https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm), filed July 29, 2026, and the [FY2026 Q4 earnings release](https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast) for independently visible statement lines and commentary.

| Input / calculation | FY2024 | FY2025 | FY2026 |
| --- | ---: | ---: | ---: |
| Total revenue | 245,122 | 281,724 | 331,839 |
| Revenue growth | — | 14.9321% | 17.7887% |

FY2026 revenue growth = `331,839 / 281,724 − 1` = **17.7887%**, displayed 17.8%. At June 30, 2026, cash and equivalents were **20,935**, current portion of long-term debt was **9,227**, and noncurrent long-term debt was **31,067**. The long-term debt subtotal = `9,227 + 31,067` = **40,294**. The filing's cash-flow line combines “depreciation, amortization, and other,” so this benchmark leaves **EBITDA, EBITDA margin, and leverage unavailable** pending a separately verified D&A input. Fixed charge coverage is unavailable for both pilots by design.

## Validation procedure

1. Open each preview and compare every displayed available metric with the arithmetic above. Check each source link and claim against the linked filing or release.
2. Generate a fresh memo after importing official SEC companyfacts and submissions JSON, or when SEC API access works. Use `npm run check:pilots` for the full calculation output.
3. Reconcile concept differences, particularly Walmart's `Revenues` versus net sales, and inspect the four-quarter bridge. Do not silently force a benchmark number into an automated result.
4. Print A, B, and C for both companies on letter paper. Obtain Ashley's layout and writing feedback before treating the design as final.
