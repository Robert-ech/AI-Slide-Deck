# DS3 financial calculations — comparison branch

Branch: **codex/financial-calculations-comparison**

This branch adds Vidit's standalone TypeScript calculation module in **calculations/** so Daksh can compare it with his version. The module consumes saved SEC JSON and returns metrics, trend series, source inputs, and missing-data explanations. It makes no API or LLM calls.

~~~sh
cd calculations
npm ci
npm test
npm run typecheck
npm run calculate -- --cik 0000001234 --facts examples/companyfacts.json --submissions examples/submissions.json --out output/example-result.json
~~~

The included example is fictional. Read [the calculation handoff](calculations/README.md) for the input contract, formulas, comparison procedure, and limitations. The calculation engine and its 17 tests are preserved unchanged from the prototype; the package adds a standalone runner and extracts only the required types and source-link helper.

The existing Python scripts at the repository root remain available for the team's retrieval and comparison work. This branch is a calculation reference, not a complete memo application or proof of correctness for every issuer.
