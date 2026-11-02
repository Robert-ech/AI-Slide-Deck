# Local evidence imports

The pilot memos contain filing-backed figures. Additional maturities, ratings, and Google Trends observations enter through **manual analyst imports**; the app does not retrieve or verify the content behind a submitted URL. An analyst must set `reviewed: true` explicitly before the imported record appears as available evidence in the memo. Each import returns `{ "memo": ... }`, changes the memo back to draft, and is stored in the local SQLite database.

## Shared source and identity rules

Use `POST /api/memos/{id}/maturities`, `/ratings`, or `/trends` with JSON and a `ticker` matching the memo. Source links must be HTTPS and have no embedded credentials. `access` (`public` or `licensed`) describes access rights; `provenance` records how evidence entered the memo. These are separate fields.

Maturity and rating imports require **exactly one** of:

- `sourceId`: an existing source in this memo. Maturities accept a filing or analyst document. Ratings accept a rating-agency or analyst document.
- `source`: `{ "title": string, "url": HTTPS URL, "access": "public" | "licensed", "publishedAt"?: YYYY-MM-DD, "note"?: string }`. New sources are tagged as analyst supplied.

An analyst supplied link is a citation, not an automated confirmation of the document's contents. Keep `reviewed: false` until the record, units, date, company, and source have been checked.

## Debt maturities

Submit `asOf` (`YYYY-MM-DD`), `currency: "USD"`, `scale: "millions"`, a precise `basis`, `reviewed`, and ordered `buckets`. Each bucket has `label`, `fiscalYear` (a year or `null` for the final `Thereafter` bucket), and `senior`, `junior`, and `unclassified` amounts. Amounts are nonnegative numbers in **USD millions**. Use `null` when a seniority split is not reported; use `0` only for a reported zero. The source date cannot be in the future.

The `basis` and optional `note` should explain whether the schedule is principal or carrying value and any difference from the headline debt metric. For example, Microsoft's FY2026 principal maturity schedule and its carrying debt subtotal have different bases in the same filing.

## Credit ratings

Submit `agency` (`Moody's`, `S&P`, `Fitch`, or `Other`), the grade in `rating`, the rated obligation in `scope`, `asOf` (`YYYY-MM-DD`), `reviewed`, and a source. A rating date cannot be in the future. The app records the stated grade and scope; it does not independently query a ratings agency. Leave the rating unavailable if its current scope or source cannot be established.

## Google Trends

Submit `csv` as the text of a single-query Google Trends export, plus `query`, `geography` (the exact label in the CSV), `periodStart`, `periodEnd`, `retrievedAt` (`YYYY-MM-DD`), `reviewed`, and a public `source` link on `https://trends.google.com/trends/...`. A client can read the chosen file with `File.text()` and send its contents in JSON. The original CSV is **not persisted**; only parsed relative-index observations and metadata are saved.

The query and geography must match the CSV header. `periodStart` and `periodEnd` must match the first and last observation boundaries, including a full week, month, or year when those are the export's units. Dates must ascend and retrieval cannot be in the future. Google indexes must be integers from 0 to 100. The export token `<1` is stored as `null` with an explanation rather than converted to a made-up value. Unreviewed or insufficient series display N/A.
