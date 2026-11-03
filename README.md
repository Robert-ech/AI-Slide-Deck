# DS3 × J.P. Morgan company research demo

The demo website lives in **frontend/** on the **demo/frontend** branch. It presents the proposed two-page company research memo using saved Walmart and Microsoft FY2026 examples.

## Run the frontend

Node.js 20.9 or newer and npm are required.

~~~sh
cd frontend
npm ci
npm run dev
~~~

Open the local URL printed by Next.js, usually http://127.0.0.1:3000. No API keys or environment file are needed for the frontend.

For the static production preview:

~~~sh
npm run build
npm start
~~~

The static preview runs at http://127.0.0.1:8767. Set PORT to choose another port. The built out/ folder can also be served by a static web host.

## What works in this demo

- Walmart is visible on first load. Select Walmart or Microsoft, or search either company by name or ticker.
- Both memo pages are displayed: financial position, charts, business perspective, and source citations.
- Page links jump to the financial or business section. Company selection supports the keyboard.
- Print / Save as PDF checks the layout before opening the browser print dialog for two letter pages.
- Source links open the original filings and company release.

The app uses bundled, dated examples. It makes no company-search, news, SEC, LLM, or database API requests. The commentary is prewritten. Live company research, new memo generation, additional imports, and follow-up Q&A are future integrations. Unsupported fields remain N/A; no placeholder Trends series or credit ratings are invented.

## Frontend structure

- frontend/src/components/DemoWorkbench.tsx — local sample selection and demo controls
- frontend/src/components/MemoView.tsx — both memo pages, charts, and citations
- frontend/src/lib/pilots.ts — bundled Walmart and Microsoft examples
- frontend/src/lib/types.ts — the shared memo shape for later integrations
- frontend/src/app/ — page, metadata, and responsive/print styles
- frontend/public/brand/ — J.P. Morgan logo assets and their source record
- frontend/scripts/serve.mjs — local static-file preview server

Run npm run typecheck and npm run build from frontend/ before committing frontend changes. Build output, local screenshots/PDFs, dependencies, and credentials are ignored.

The existing metrics.py and Metrics.md remain at the repository root for the team's financial-data work. The frontend does not invoke that script.

The website identifies itself as a DS3 Consulting project demo. The J.P. Morgan wordmark replaces the former Fieldnote branding.
