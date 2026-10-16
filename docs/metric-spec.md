# Metric specification, version 0.1

All money values are stored in USD, displayed in billions on the memo, and tied to an SEC filing accession. Annual income statement and cash-flow values must span roughly 330–400 days. Direct quarterly values span roughly 70–110 days. A year-to-date Q2 or Q3 fact becomes a standalone quarter by subtracting the preceding cumulative fact with the same start date. Q4 is full-year less nine months. The two inputs remain attached to the derived point. Comparable-quarter growth uses the corresponding quarter about one year earlier.

| Output | Source fields / formula | Missing-data rule |
| --- | --- | --- |
| Revenue | Prefer `us-gaap:Revenues` as the reported top line; otherwise `RevenueFromContractWithCustomerExcludingAssessedTax` or `SalesRevenueNet` | Unavailable when no comparable annual fact is mapped. The exact concept is retained in each fact record. |
| Revenue growth | Latest annual revenue / previous annual revenue − 1 | Unavailable when either amount is absent, prior revenue is zero, or FY ends are not about one year apart. |
| Estimated EBITDA | `OperatingIncomeLoss` + separately mapped depreciation and amortization | Unavailable when either input for the same period is absent. This is an estimate, never a reported or covenant EBITDA. A combined “depreciation, amortization, and other” line is insufficient. |
| Estimated EBITDA margin | Estimated EBITDA / revenue | Unavailable unless both aligned values exist and revenue is nonzero. |
| Cash | `CashAndCashEquivalentsAtCarryingValue` at the latest filing date | Unavailable if no tagged cash fact exists. Cash restrictions are researched separately. |
| Debt | Short-term borrowings, if tagged, + current and noncurrent long-term debt at one balance-sheet date | If either long-term component is missing, unavailable. If no short-term fact is mapped, label the result **long-term debt subtotal**, not comprehensive debt. Lease obligations are excluded. |
| Gross leverage estimate | Included debt / four consecutive standalone quarters of estimated EBITDA, if ending on the debt date; otherwise same-date FY estimated EBITDA | Unavailable if the debt and EBITDA dates differ, one of four quarters is missing, or EBITDA is not positive. This is not a covenant ratio. |
| Fixed charge coverage | Definition pending | Always unavailable until Ashley approves numerator, denominator, and required debt-service inputs. |

The SEC filing URL, accession, filed date, concept, unit, start/end dates, and value are retained for every selected input. A metric contains its formula and input fact IDs. Insights contain public source IDs. Every generated memo stays in draft until an analyst verifies all insights. Industry text has a separate licensed source and is never included in the AI input.

Known limitations: standardized XBRL tags vary across issuers; tag mapping must be checked against the actual filing in each pilot. Debt omits leases, and an untagged short-term facility may be missed. The one-page ratio is a screening calculation, not a credit agreement definition.
