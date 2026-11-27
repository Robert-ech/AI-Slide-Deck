# Financial calculations — comparison handoff

This is the standalone TypeScript calculation module from Vidit's research-memo prototype, packaged for Daksh to compare with his implementation. It is a draft calculation reference with executable tests. It is not connected to the frontend demo, and it does not retrieve data or independently verify numbers against original filing text.

## Run it

Use Node.js 20.9 or newer and npm:

~~~sh
npm ci
npm test
npm run typecheck
~~~

Run the included **fictional** example without credentials or network requests:

~~~sh
npm run calculate -- --cik 0000001234 --facts examples/companyfacts.json --submissions examples/submissions.json --out output/example-result.json
~~~

The example should produce revenue of $120M, gross margin of 40%, estimated EBITDA of $36M, cash of $10M, debt of $23M, and debt/estimated EBITDA of about 0.639×. These are invented comparison inputs, not company research.

To compare both implementations on real data, provide the same unmodified SEC companyfacts and submissions JSON files and the same CIK. Those files are not included. Run the same command with your own paths and compare the chosen concepts, periods, source inputs, formulas, values, and N/A reasons—not just the displayed rounded result.

## Package contents and input/output

- src/lib/financials.ts: unchanged calculation engine; buildFinancials(cik, facts, submissions).
- src/lib/sec.ts: SEC input shapes and the original filing-link helper only.
- src/lib/types.ts: the four output types needed by the calculator.
- tests/financials.test.ts: unchanged 17-test calculation suite, using constructed input fixtures.
- scripts/calculate.ts: offline JSON runner with basic input-shape and company-identity checks; it is not a full SEC schema validator.
- METRIC_RULES.md: formulas, period rules, provenance, and missing-data behavior.
- SOURCE_MANIFEST.json: source revision and hashes for the unchanged engine and tests.

The module returns metrics, annual and standalone-quarter trends, the input facts used, source URLs, a period label, and warnings. Dollar amounts are raw USD. Percentage outputs use percentage points (40 means 40%). Ratios are multiples. Missing values are null with a reason.

## Coverage

Revenue and growth; compatible gross profit and gross margin; reported-EBITDA selection or an explicitly estimated operating-income-plus-D&A fallback; EBITDA margin; cash; debt subtotals; aligned debt/EBITDA; and optional inventory/receivables days. Fixed charge coverage remains unavailable pending the agreed definition.

The tests cover FY/quarter alignment, Q4 derivation, same-filing inputs, missing D&A, gross-margin denominators, EBITDA selection, working-capital periods, and N/A explanations. Passing them demonstrates those fixture cases; it does not establish correctness for every issuer or prove that a live data provider returned the right value.

## Comparison and remaining review

1. Use identical company, fiscal periods, and source documents in both versions.
2. Compare source concepts before arithmetic. Walmart's net-sales denominator for gross margin differs from its total-revenue headline.
3. Check annual versus year-to-date versus standalone-quarter values, and how restatements are selected.
4. Check missing short-term debt, lease treatment, and whether each EBITDA input is separately supported. Some fallback debt tags include capital-lease obligations; the generic debt note must not be treated as proof that leases are excluded in every case.
5. Compare unavailable cases as well as successful calculations. Keep conflicting or unsupported values unavailable until reviewed.
6. Reconcile accepted results to the underlying filings before connecting the selected implementation to the memo.

Issuer-specific XBRL mapping, debt definitions, and non-GAAP EBITDA definitions still require review. If Daksh's pipeline already retrieves and cross-checks source values, this package can supply useful calculation rules and regression cases alongside it. No API keys, model calls, database, client material, or source-document extracts are included.
