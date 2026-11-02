import assert from "node:assert/strict";
import test from "node:test";
import { pilotMemo } from "../src/lib/pilots";

for (const ticker of ["WMT", "MSFT"] as const) {
  test(`${ticker} FY2026 preview has traceable measures and no invented unavailable data`, () => {
    const memo = pilotMemo(ticker);
    const sourceIds = new Set(memo.sources.map((source) => source.id));
    const factIds = new Set(memo.facts.map((fact) => fact.id));
    assert.ok(memo.sources.every((source) => source.url.startsWith("https://")));
    assert.ok(memo.facts.every((fact) => sourceIds.has(fact.sourceId)));
    assert.ok(memo.metrics.every((metric) => metric.inputFactIds.every((id) => factIds.has(id))));
    assert.ok(memo.metrics.filter((metric) => metric.status === "unavailable").every((metric) => metric.value === null && metric.unavailableReason));
    assert.ok(memo.insights.every((insight) => insight.evidenceIds.length && insight.evidenceIds.every((id) => sourceIds.has(id)) && !insight.reviewed));
    assert.equal(memo.metrics.find((metric) => metric.id === "fccr")?.value, null);
    assert.equal(memo.googleTrends, undefined);
    assert.equal(memo.creditRatings, undefined);
    assert.equal(memo.reviewStatus, "draft");
    assert.ok(memo.annualTrends.every((point) =>
      point.grossProfitFactIds?.every((id) => factIds.has(id)) && point.grossMarginBaseFactIds?.every((id) => factIds.has(id))));
  });
}

test("Walmart margin uses net sales and maturities omit short-term borrowings", () => {
  const memo = pilotMemo("WMT");
  assert.equal(memo.metrics.find((metric) => metric.id === "revenue")?.value, 713163e6);
  assert.ok(Math.abs((memo.metrics.find((metric) => metric.id === "gross-margin")?.value ?? 0) - 171018 / 706413 * 100) < 1e-9);
  assert.equal(memo.annualTrends.at(-1)?.grossMarginBase, 706413e6);
  assert.equal(memo.debtMaturities?.buckets.reduce((sum, bucket) => sum + (bucket.unclassified ?? 0), 0), 38166);
  assert.equal(memo.metrics.find((metric) => metric.id === "debt")?.value, 44762e6);
  assert.ok(memo.debtMaturities?.buckets.every((bucket) => bucket.senior === null && bucket.junior === null));
});

test("Microsoft maturity face value reconciles separately from carrying debt", () => {
  const memo = pilotMemo("MSFT");
  assert.ok(Math.abs((memo.metrics.find((metric) => metric.id === "gross-margin")?.value ?? 0) - 225465 / 331839 * 100) < 1e-9);
  const scheduleTotal = memo.debtMaturities?.buckets.reduce((sum, bucket) => sum + (bucket.senior ?? 0), 0);
  assert.equal(scheduleTotal, 46136);
  assert.equal(scheduleTotal! - 1081 - 11 - 4750, 40294);
  assert.equal(memo.metrics.find((metric) => metric.id === "debt")?.value, 40294e6);
  assert.equal(memo.metrics.find((metric) => metric.id === "ebitda")?.value, null);
  assert.ok(memo.debtMaturities?.buckets.every((bucket) => bucket.junior === 0 && bucket.unclassified === 0));
});
