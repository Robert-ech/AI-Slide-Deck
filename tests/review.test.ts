import assert from "node:assert/strict";
import test from "node:test";
import { reviewProblem, sourceIsReviewed } from "../src/lib/review";
import type { Insight, Source } from "../src/lib/types";

const filing: Source = { id: "sec:1", title: "Annual filing", url: "https://www.sec.gov/filing", kind: "filing", access: "public" };
const article: Source = { id: "news:1", title: "Company article", url: "https://example.com/article", kind: "public-news", access: "public", provenance: "analyst-supplied", reviewed: false };
const insight: Insight = { id: "i1", kind: "context", text: "The company opened a new site.", evidenceIds: ["news:1"], reviewed: true };

test("filings are primary evidence; analyst-added sources need explicit review", () => {
  assert.equal(sourceIsReviewed(filing), true);
  assert.equal(sourceIsReviewed(article), false);
  assert.match(reviewProblem([insight], [filing, article])!, /Review the cited source/);
  assert.equal(reviewProblem([insight], [filing, { ...article, reviewed: true }]), null);
});

test("memo review rejects missing citations and unchecked insights", () => {
  assert.match(reviewProblem([{ ...insight, reviewed: false }], [article])!, /every insight/);
  assert.match(reviewProblem([{ ...insight, evidenceIds: [] }], [article])!, /source citation/);
  assert.match(reviewProblem([{ ...insight, evidenceIds: ["missing"] }], [article])!, /unknown source/);
});
