# Fieldnote: local credit research memo

Fieldnote is a private, single-analyst Next.js workbench for public-company credit research. It helps a banker move from source material to a cited two-page memo. Walmart and Microsoft FY2026 are fixed, manually reconciled pilot previews; a newly generated memo uses the SEC data available when it runs.

## Run locally

~~~sh
npm install
cp .env.example .env.local
npm run dev
~~~

Open the local address printed by Next.js. The server binds to 127.0.0.1. You can inspect either fixed pilot without credentials. For a fresh memo, set SEC_USER_AGENT in .env.local to a project name and real contact email, or use the sidebar to import the official SEC companyfacts and submissions JSON files. The app links to the official downloads. Imported JSON and SQLite data stay in ignored data/.

## Workbench and memo

1. Search by company name or ticker and select a company. The fixed Walmart and Microsoft preview buttons are design and reconciliation references.
2. Generate a draft from SEC company facts and submissions. The calculator retains concept, unit, period, accession, filed date, and source URL for each selected filing fact. It aligns periods before combining facts and shows an explicit N/A reason when it cannot support a calculation.
3. Review the two letter-sized memo pages. Page 1 shows the provisional six metrics (revenue, gross margin, EBITDA or estimated EBITDA, cash, debt, and leverage), fixed charge coverage, annual revenue and gross-margin trends, debt maturities, Google search interest, and a dated credit rating when supported. Page 2 covers business drivers, risks, opportunities, industry context, dated public evidence, and a numbered source register.
4. Add and review evidence in the workbench. Maturity schedules, dated ratings, and Google Trends CSV exports are manual, source-linked imports. The Trends import stores the query, geography, period, retrieval date, and parsed index series, not the original CSV. Public industry context can be added with a source and analyst review; licensed IBISWorld context is optional when your account permits it.
5. Edit draft insights and review their cited sources. A memo cannot be marked reviewed until the source and insight checks pass. Without an OpenAI key, the app creates editable local observations; with a key, it drafts public-evidence insights through the Responses API with store disabled. Analyst review is still required.
6. Use Print / Save as PDF. The app checks that both memo pages fit before opening the browser print dialog. Choose Save as PDF there; there is no automated PDF service.

Fixed charge coverage remains N/A until Ashley approves the formula and inputs. An absent rating, maturity breakdown, or reviewed Trends export remains N/A. The app does not manufacture a value or claim that Google Trends or rating agencies are queried automatically. The six headline measures and two-page writing density are provisional pending Ashley's feedback.

## Verification

~~~sh
npm run typecheck
npm test
npm run check:pilots:fixed
npm run build
~~~

The fixed check reconciles both bundled FY2026 previews without network access. Run npm run check:pilots after SEC access works or after importing the official JSON files; it checks fresh calculator output and does not silently substitute the fixed previews. [Pilot benchmarks](docs/pilot-benchmarks.md) give the filing arithmetic and maturity-basis differences. [Metric rules](docs/metric-spec.md) define formulas and N/A behavior. [Evidence imports](docs/evidence-imports.md) describe manual source and review requirements. [Ashley review brief](docs/ashley-review.md) lists the open layout, metric, writing, and Trends decisions.

## Local data and access

The repository is private. .gitignore excludes credentials, SQLite, downloaded SEC data, licensed reports, source extracts, generated PDFs, and local visual-check output. The app accepts local write requests only from loopback origins and expected content types. API keys and passwords are read by server routes, not embedded in the browser bundle. A configured SEC, IBISWorld, or OpenAI integration sends the inputs needed for that service; local storage does not mean those enabled services are offline.

Before setting IBISWORLD_LICENSE_CONFIRMED=true, verify that your account permits API retrieval and local display of the chosen report. Licensed text is excluded from OpenAI prompts. A public source link added by an analyst is a citation to review, not automated verification of its contents.

The FY2026 pilot previews are dated examples, not live filing refreshes. SEC requests may return HTTP 403 in some environments even with a valid user agent; use the official JSON import path then. Ashley's metric ranking, fixed-charge-coverage definition, and writing examples remain review items.
