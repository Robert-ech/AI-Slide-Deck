import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Memo } from "../src/lib/types";

test("reviewed public industry context is sourced, local, and replaces an older industry extract", async () => {
  const previous = process.cwd();
  const directory = mkdtempSync(path.join(tmpdir(), "ds3-industry-"));
  try {
    process.chdir(directory);
    const { saveMemo, getMemo } = await import("../src/lib/db");
    const { POST } = await import("../src/app/api/memos/[id]/industry/public/route");
    const memo: Memo = {
      id: "industry-memo", company: { name: "Example", ticker: "EXM", cik: "1" },
      generatedAt: "2026-10-20T00:00:00Z", periodLabel: "FY2026", facts: [], metrics: [], annualTrends: [], quarterlyTrends: [], insights: [],
      sources: [{ id: "old", title: "Old industry report", url: "https://example.com/old", kind: "industry", access: "licensed" }],
      industry: { reportCode: "OLD", reportTitle: "Old industry report", summary: "Old summary", sourceId: "old" },
      warnings: [], generationMode: "local-draft", reviewStatus: "reviewed",
    };
    saveMemo(memo);
    const context = { params: Promise.resolve({ id: memo.id }) };
    const body = { title: "Public industry research", url: "https://example.com/research", publishedAt: "2026-10-20",
      summary: "A public report describes the industry demand outlook and its main cost pressures for this company.", reviewed: true };
    const request = (payload: unknown) => new NextRequest("http://localhost:8767/api/memos/industry-memo/industry/public", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    assert.equal((await POST(request({ ...body, reviewed: false }), context)).status, 400);
    assert.equal(getMemo(memo.id)?.industry?.sourceId, "old");
    const response = await POST(request(body), context);
    assert.equal(response.status, 200);
    const saved = getMemo(memo.id)!;
    assert.equal(saved.industry?.reportCode, "PUBLIC");
    assert.equal(saved.sources.length, 1);
    assert.equal(saved.sources[0].id, saved.industry?.sourceId);
    assert.equal(saved.sources[0].reviewed, true);
    assert.equal(saved.reviewStatus, "draft");
  } finally {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});
