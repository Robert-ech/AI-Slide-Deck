import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { Insight } from "../src/lib/types";
import { buildPrivateMemo } from "../src/lib/private-memo";

const input = {
  company: { name: "Harbor Gridworks" },
  description: { text: "Harbor Gridworks makes control equipment for industrial customers.", sourceIds: ["site"] },
  valueProposition: { text: "Its modular controllers reduce installation time.", sourceIds: ["site"] },
  founders: [{ text: "A founder previously led industrial product teams.", sourceIds: ["profile"] }],
  fundingRounds: [{ stage: "Series A", announcedAt: "2026-03-01", amountUsd: 20_000_000,
    investors: ["Example Capital"], sourceIds: ["funding"] }],
  financialPeriods: [
    { label: "FY2025", periodType: "annual", end: "2025-12-31", sourceId: "financials",
      revenueUsd: 80_000_000, ebitdaUsd: 10_000_000 },
    { label: "FY2026", periodType: "annual", end: "2026-12-31", sourceId: "financials",
      revenueUsd: 100_000_000, ebitdaUsd: 12_000_000, debtUsd: 24_000_000 },
  ],
  sources: [
    { id: "site", title: "Company website", url: "https://example.com/company", kind: "company-website",
      note: "Describes the company and product." },
    { id: "profile", title: "Founder profile", url: "https://example.com/founder", kind: "founder-profile",
      note: "Lists the founder's background." },
    { id: "funding", title: "Funding announcement", url: "https://example.com/funding", kind: "funding",
      note: "Reports the Series A amount and named investor." },
    { id: "financials", title: "Financial extract", url: "https://example.com/financials", kind: "analyst-document",
      access: "licensed", note: "Contains two annual periods." },
  ],
};

test("private memo calculates only supported, comparable measures", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const memo = await buildPrivateMemo(input);
    assert.equal(memo.company.kind, "private");
    assert.equal(memo.metrics.find((item) => item.id === "revenue-growth")?.value, 25);
    assert.equal(memo.metrics.find((item) => item.id === "leverage")?.value, 2);
    assert.equal(memo.metrics.find((item) => item.id === "cash"), undefined);
    assert.equal(memo.sources.find((item) => item.id === "financials")?.access, "licensed");
    assert.equal(memo.sources.find((item) => item.id === "site")?.reviewed, false);
    assert.deepEqual(memo.insights[0].evidenceIds, ["site"]);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("private memo rejects uncited claims and incompatible growth", async () => {
  await assert.rejects(buildPrivateMemo({ ...input, description: { text: "Uncited claim", sourceIds: ["missing"] } }),
    /unknown source/);
  const memo = await buildPrivateMemo({ ...input, financialPeriods: [
    input.financialPeriods[0],
    { ...input.financialPeriods[1], periodType: "quarterly" },
  ] });
  assert.equal(memo.metrics.find((item) => item.id === "revenue-growth"), undefined);
  assert.equal(memo.metrics.find((item) => item.id === "leverage"), undefined);
});

test("private memo permits a sourced business profile without financial figures", async () => {
  const memo = await buildPrivateMemo({ company: input.company, description: input.description, sources: [input.sources[0]] });
  assert.equal(memo.metrics.length, 0);
  assert.match(memo.warnings.join(" "), /financial measures are omitted/);
  assert.equal(memo.privateProfile?.fundingRounds.length, 0);
});

test("private handoff route saves the memo and permits source review", async () => {
  const originalCwd = process.cwd();
  const temp = mkdtempSync(path.join(tmpdir(), "ds3-private-route-"));
  try {
    process.chdir(temp);
    const { POST } = await import("../src/app/api/memos/private/route");
    const { PATCH } = await import("../src/app/api/memos/[id]/route");
    const request = new NextRequest("http://localhost/api/memos/private", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
    const created = await POST(request);
    assert.equal(created.status, 201);
    const { memo } = await created.json();
    assert.equal(memo.company.kind, "private");
    const reviewed = await PATCH(new NextRequest("http://localhost/api/memos/" + memo.id, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceReviews: [{ id: "site", reviewed: true }] }),
    }), { params: Promise.resolve({ id: memo.id }) });
    assert.equal(reviewed.status, 200);
    assert.equal((await reviewed.json()).memo.sources.find((item: { id: string }) => item.id === "site").reviewed, true);
    const premature = await PATCH(new NextRequest("http://localhost/api/memos/" + memo.id, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewStatus: "reviewed",
        insights: memo.insights.map((item: Insight) => ({ ...item, reviewed: true })),
        sourceReviews: [{ id: "funding", reviewed: true }] }),
    }), { params: Promise.resolve({ id: memo.id }) });
    assert.equal(premature.status, 400);
    assert.match((await premature.json()).error, /every private-company source/);
  } finally {
    process.chdir(originalCwd);
    rmSync(temp, { recursive: true, force: true });
  }
});
