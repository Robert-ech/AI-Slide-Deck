# Team 1 → memo generator: private-company handoff

Team 1 collects and extracts evidence. This application does not scrape private-company data. Team 1 can hand off one UTF-8 JSON object through the workbench's **Private company · Team 1 handoff** panel or POST it to \`/api/memos/private\` from the local machine. The response is \`{ "memo": ... }\` and the saved memo appears in the local archive.

Start with [the illustrative example](../public/examples/private-company.json). Replace every example value and URL with checked source material. The example is fictional.

## Fields

- \`company.name\` and \`description: { text, sourceIds }\` are required.
- \`industry\`, \`valueProposition\`, and \`businessDetails\` use the same cited-claim shape.
- \`founders\`, \`investors\`, and \`competitors\` are optional arrays of cited claims.
- \`fundingRounds\` is an optional array of \`{ stage, announcedAt?, amountUsd?, investors?, sourceIds }\`. Omit undisclosed amounts.
- \`financialPeriods\` is an optional array of \`{ label, periodType, end, sourceId, revenueUsd?, ebitdaUsd?, cashUsd?, debtUsd? }\`. \`periodType\` is \`annual\` or \`quarterly\`; amounts are raw USD. At least one amount must be present in each supplied period.
- \`sources\` is a required array of \`{ id, title, url, kind, access?, publishedAt?, note }\`. IDs must be unique. The URL must be HTTPS without embedded credentials. \`access\` defaults to \`public\`; use \`licensed\` for restricted material. Every claim and financial period must reference a listed source.

Source \`kind\` may be \`company-website\`, \`company-release\`, \`public-news\`, \`industry\`, \`funding\`, \`founder-profile\`, or \`analyst-document\`. A link and a note establish provenance, but do not prove the underlying claim. Imported sources and insights begin unreviewed.

## Analysis and presentation rules

The generator displays only supplied facts and claims. It computes annual revenue growth only from adjacent annual fiscal years with comparable year-end dates. It computes a screening debt/EBITDA ratio only when both amounts are supplied for the latest annual period and EBITDA is positive. It does not infer cash, debt, a credit rating, or an EBITDA definition from missing data.

The two-page private memo leads with the business model and value proposition, followed by available financials and financing history. Page 2 covers founders, investors, competitors, source-backed observations, credit questions, and the cited source register. Missing optional sections disappear. The existing print action checks both letter pages for overflow before opening Save as PDF.

When an OpenAI key is configured, only claims and source notes marked \`public\` are sent for AI draft commentary. Licensed financial amounts and restricted claims stay local. The model is instructed to cite source IDs and avoid unsupported causal explanations. The analyst must check sources and review every insight before the memo can be marked reviewed.
