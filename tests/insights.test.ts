import assert from "node:assert/strict";
import test from "node:test";
import { fallbackInsights } from "../src/lib/insights";
import type { Metric, Source } from "../src/lib/types";

function metric(id: string, value: number | null, inputFactIds: string[]): Metric {
  return { id, label: id, period: "FY 2026", value, unit: id === "revenue-growth" ? "percent" : id === "leverage" ? "multiple" : "USD",
    formula: "Filing-based screening measure", inputFactIds, status: value === null ? "unavailable" : "calculated" };
}
const filing: Source = { id: "filing", title: "Annual 10-K", url: "https://www.sec.gov/example", kind: "filing", access: "public" };

test("local draft omits missing measures instead of assigning an unrelated filing citation", () => {
  const insights = fallbackInsights([
    metric("revenue-growth", null, []), metric("leverage", null, []), metric("cash", null, []),
  ], [filing], [], new Map());
  assert.deepEqual(insights, []);
});

test("local draft cites actual input facts and a dated public evidence note", () => {
  const article: Source = { id: "news", title: "Public update", url: "https://example.com/news", kind: "public-news",
    access: "public", publishedAt: "2026-10-20", note: "The company reported a new distribution center.", reviewed: false };
  const insights = fallbackInsights([
    metric("revenue-growth", 4.7, ["rev-26", "rev-25"]), metric("leverage", null, []), metric("cash", 10.7e9, ["cash"]),
  ], [filing, article], [], new Map([["rev-26", "filing"], ["rev-25", "filing"], ["cash", "filing"]]));
  assert.equal(insights.length, 3);
  assert.deepEqual(insights.map((insight) => insight.evidenceIds), [["filing"], ["filing"], ["news"]]);
  assert.ok(insights.every((insight) => !insight.reviewed));
  assert.match(insights[2].text, /2026-10-20/);
});
