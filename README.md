# Fieldnote: local credit research memo

A private, single-analyst Next.js workbench for a public-company credit research memo. The working app and SQLite database stay on this computer. A two-page website preview for the manually checked Walmart and Microsoft FY2026 pilots is ready for Ashley's layout review.

## Start locally

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open the local address printed by Next.js. The app binds to `127.0.0.1`. Preview either pilot without credentials. A new memo needs official SEC data: set `SEC_USER_AGENT` to a project name and a real contact email, or import the two official JSON files for a pilot using the sidebar. Get them from the links shown in the app. Downloaded JSON is stored under ignored `data/sec/` and is never committed.

Run `npm run typecheck`, `npm test`, and `npm run build` before sharing code. `npm run check:pilots` compares the calculator output for both pilots after SEC data is accessible or imported.

## What a new memo does

1. Resolve ticker to CIK, load SEC submissions and company facts, and retain unit, period, filing date, accession, and source URL for each used fact.
2. Build annual and comparable quarterly revenue and estimated EBITDA series. Derive standalone quarters from year-to-date facts when necessary.
3. Calculate the credit snapshot from aligned periods. Missing or incompatible inputs appear as unavailable. Fixed charge coverage stays unavailable until Ashley approves its definition.
4. Add analyst supplied public sources with verified notes. News search returns dated candidates; a candidate becomes evidence only after the analyst enters a note.
5. Draft 3–5 insights from public evidence. With an OpenAI key, this uses the Responses API with `store: false` and a structured output. Without a key, the app creates editable, source-linked local observations. All claims require analyst review.
6. Optionally add IBISWorld context locally by report code. Its licensed text is excluded from the OpenAI request.

The archive is a local SQLite file at `data/memos.sqlite`. The **Print / Save as PDF** control opens the browser print dialog for two letter-sized pages. The six headline measures are provisional. Gross margin, debt maturities, Google Trends, and fixed charge coverage show N/A in the preview because their new data paths or definitions have not been implemented. The outlined debt chart is a layout sample, not company data.

## Privacy and access

The GitHub personal repository is private. `.gitignore` excludes `.env.local`, downloaded reports, source extracts, generated exports, the database, and build files. API keys and passwords are used only in server routes. Do not paste credentials into the app's source-note field. SEC and IBISWorld requests contact their respective services; OpenAI receives public filing metadata, public source notes, metrics, and trends only when its key is configured. Local use is therefore private storage, but enabled integrations still send the stated inputs to those services.

Before setting `IBISWORLD_LICENSE_CONFIRMED=true`, verify that your specific account permits API retrieval and local display of the chosen report. No IBISWorld text is sent to OpenAI under this project's rule. The app rejects IBISWorld lookup until this local flag is set.

## Review gates and limits

- [Pilot benchmarks](docs/pilot-benchmarks.md) show the manual arithmetic and filing trail.
- [Metric rules](docs/metric-spec.md) define sources, periods, formulas, and missing-data behavior.
- [Ashley review brief](docs/ashley-review.md) frames the layout and writing feedback.

The FY2026 pilot previews are fixed design references, not live updates. SEC requests from some network environments may return HTTP 403 even with a valid user agent; use the official JSON import path in that case. Live OpenAI and IBISWorld calls require the relevant credentials and account permissions. The app cannot supply Ashley's writing example or approve the fixed charge coverage formula on her behalf.
