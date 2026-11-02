import assert from "node:assert/strict";
import test from "node:test";
import { applyMaturityImport, applyRatingImport, isValidEvidenceUrl } from "../src/lib/evidence";
import type { Memo } from "../src/lib/types";

function memo(): Memo {
  return {
    id: "test-memo", company: { name: "Example Co", ticker: "EXM", cik: "1" },
    generatedAt: "2026-10-26T00:00:00.000Z", periodLabel: "FY2026",
    facts: [], metrics: [], annualTrends: [], quarterlyTrends: [], insights: [],
    sources: [{ id: "filing-1", title: "FY2026 10-K", url: "https://www.sec.gov/Archives/example", kind: "filing", access: "public" }],
    warnings: [], generationMode: "local-draft", reviewStatus: "reviewed",
  };
}

const maturity = {
  ticker: "EXM", asOf: "2026-06-30", currency: "USD", scale: "millions", basis: "Scheduled principal payments, not carrying value",
  reviewed: true, sourceId: "filing-1",
  buckets: [
    { label: "FY2027", fiscalYear: 2027, senior: null, junior: null, unclassified: 100 },
    { label: "FY2028", fiscalYear: 2028, senior: null, junior: null, unclassified: 0 },
    { label: "Thereafter", fiscalYear: null, senior: null, junior: null, unclassified: 50 },
  ],
};

test("source links require HTTPS and no embedded credentials", () => {
  assert.equal(isValidEvidenceUrl("https://www.sec.gov/Archives/example"), true);
  assert.equal(isValidEvidenceUrl("http://www.sec.gov/Archives/example"), false);
  assert.equal(isValidEvidenceUrl("https://user:pass@example.com/report"), false);
  assert.equal(isValidEvidenceUrl("javascript:alert(1)"), false);
});

test("maturities keep reported zeros and an unclassified thereafter bucket", () => {
  const result = applyMaturityImport(memo(), maturity);
  assert.equal(result.debtMaturities?.buckets[1].unclassified, 0);
  assert.equal(result.debtMaturities?.buckets[2].fiscalYear, null);
  assert.equal(result.debtMaturities?.sourceId, "filing-1");
  assert.equal(result.reviewStatus, "draft");
});

test("maturity import rejects a different company, duplicate years, and missing provenance", () => {
  assert.throws(() => applyMaturityImport(memo(), { ...maturity, ticker: "OTHER" }), /memo is for EXM/);
  assert.throws(() => applyMaturityImport(memo(), { ...maturity, buckets: [maturity.buckets[0], maturity.buckets[0]] }), /Duplicate maturity year/);
  assert.throws(() => applyMaturityImport(memo(), { ...maturity, sourceId: "missing" }), /Unknown or invalid sourceId/);
  assert.throws(() => applyMaturityImport(memo(), { ...maturity, scale: undefined }), /million/);
  assert.throws(() => applyMaturityImport(memo(), { ...maturity, asOf: "2099-01-01" }), /future/);
  const wrongSource = memo();
  wrongSource.sources.push({ id: "trends-1", title: "Search data", url: "https://trends.google.com/trends/explore", kind: "trends", access: "public" });
  assert.throws(() => applyMaturityImport(wrongSource, { ...maturity, sourceId: "trends-1" }), /not an appropriate source/);
});

test("rating requires a dated scope and review state, and creates a traceable source", () => {
  const result = applyRatingImport(memo(), {
    ticker: "EXM", agency: "S&P", rating: "A+", scope: "Senior unsecured debt",
    asOf: "2026-10-20", reviewed: false,
    source: { title: "Ratings report", url: "https://www.example.com/ratings", access: "licensed" },
  });
  assert.equal(result.creditRatings?.[0].reviewed, false);
  assert.equal(result.creditRatings?.[0].scope, "Senior unsecured debt");
  assert.equal(result.sources[1].access, "licensed");
  assert.equal(result.sources[1].provenance, "analyst-supplied");
  assert.equal(result.sources[1].reviewed, false);
});

test("rating import rejects malformed dates, source URLs, and simultaneous source references", () => {
  const input = {
    ticker: "EXM", agency: "S&P", rating: "A+", scope: "Issuer",
    asOf: "2026-02-30", reviewed: true, sourceId: "filing-1",
  };
  assert.throws(() => applyRatingImport(memo(), input));
  assert.throws(() => applyRatingImport(memo(), { ...input, asOf: "2026-10-20", source: { title: "Bad", url: "http://example.com", access: "public" } }));
  assert.throws(() => applyRatingImport(memo(), { ...input, asOf: "2099-01-01" }), /future/);
  assert.throws(() => applyRatingImport(memo(), { ...input, asOf: "2026-10-20" }), /not an appropriate source/);
});
