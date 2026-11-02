import assert from "node:assert/strict";
import test from "node:test";
import { applyTrendsImport, parseGoogleTrendsCsv } from "../src/lib/trends";
import type { Memo } from "../src/lib/types";

const expected = {
  query: "Microsoft", geography: "United States",
  periodStart: "2026-01-01", periodEnd: "2026-03-31",
};

const csv = "Category: All categories\r\n\r\nMonth,Microsoft: (United States)\r\n2026-01,54\r\n2026-02,<1\r\n2026-03,100\r\n";

function memo(): Memo {
  return {
    id: "test-memo", company: { name: "Microsoft Corporation", ticker: "MSFT", cik: "789019" },
    generatedAt: "2026-10-26T00:00:00.000Z", periodLabel: "FY2026",
    facts: [], metrics: [], annualTrends: [], quarterlyTrends: [], insights: [], sources: [],
    warnings: [], generationMode: "local-draft", reviewStatus: "reviewed",
  };
}

test("parses a Google Trends monthly CSV without manufacturing a value for <1", () => {
  const points = parseGoogleTrendsCsv(csv, expected);
  assert.deepEqual(points.map((point) => point.interest), [54, null, 100]);
  assert.equal(points[1].note, "Export reports <1; exact value unavailable.");
  assert.deepEqual(points.map((point) => point.date), ["2026-01-01", "2026-02-01", "2026-03-01"]);
});

test("parses quoted CSV headers and weekly ranges", () => {
  const weekly = 'Week,"Microsoft: (United States)"\n2026-01-01 - 2026-01-07,0\n2026-01-08 - 2026-01-14,78';
  const points = parseGoogleTrendsCsv(weekly, { ...expected, periodEnd: "2026-01-14" });
  assert.deepEqual(points.map((point) => point.interest), [0, 78]);
});

test("rejects mismatched identity, chronology, extra query, and out-of-range values", () => {
  assert.throws(() => parseGoogleTrendsCsv(csv, { ...expected, query: "Walmart" }), /does not match/);
  assert.throws(() => parseGoogleTrendsCsv(csv, { ...expected, geography: "Worldwide" }), /does not match/);
  assert.throws(() => parseGoogleTrendsCsv(csv.replace("2026-03,100", "2026-03,101"), expected), /Invalid Google Trends index/);
  assert.throws(() => parseGoogleTrendsCsv(csv.replace("2026-03,100", "2026-01,100"), expected), /unique and ascending/);
  assert.throws(() => parseGoogleTrendsCsv(csv.replace("Month,Microsoft: (United States)", "Month,Microsoft: (United States),Other: (United States)"), expected), /one Google Trends query/);
  assert.throws(() => parseGoogleTrendsCsv(csv, { ...expected, periodEnd: "2026-04-30" }), /must match CSV observation coverage/);
});

test("import persists only parsed indexes with retrieval metadata and a reviewed source flag", () => {
  const result = applyTrendsImport(memo(), {
    ticker: "MSFT", csv, ...expected, retrievedAt: "2026-04-02", reviewed: false,
    source: { title: "Google Trends export for Microsoft", url: "https://trends.google.com/trends/explore?q=Microsoft", access: "public" },
  });
  assert.equal(result.googleTrends?.query, "Microsoft");
  assert.equal(result.googleTrends?.retrievedAt, "2026-04-02");
  assert.equal(result.googleTrends?.points[1].interest, null);
  assert.equal(result.sources[0].provenance, "google-trends-export");
  assert.equal(result.sources[0].reviewed, false);
  assert.equal(result.reviewStatus, "draft");
});

test("import rejects a non-Google source and a period ending after retrieval", () => {
  const base = {
    ticker: "MSFT", csv, ...expected, retrievedAt: "2026-04-02", reviewed: true,
    source: { title: "Google Trends export", url: "https://example.com/trends", access: "public" },
  };
  assert.throws(() => applyTrendsImport(memo(), base));
  assert.throws(() => applyTrendsImport(memo(), { ...base, retrievedAt: "2026-02-01", source: { ...base.source, url: "https://trends.google.com/trends/explore" } }));
  assert.throws(() => applyTrendsImport(memo(), { ...base, retrievedAt: "2099-01-01", source: { ...base.source, url: "https://trends.google.com/trends/explore" } }), /future/);
});
