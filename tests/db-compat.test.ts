import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Memo } from "../src/lib/types";

test("older SQLite memos without evidence extensions remain readable", async () => {
  const originalCwd = process.cwd();
  const temp = mkdtempSync(path.join(tmpdir(), "ds3-memo-db-"));
  try {
    process.chdir(temp);
    const { getMemo, saveMemo } = await import("../src/lib/db");
    const legacy: Memo = {
      id: "legacy-1", company: { name: "Example Co", ticker: "EXM", cik: "1" },
      generatedAt: "2026-10-01T00:00:00.000Z", periodLabel: "FY2025",
      facts: [], metrics: [], annualTrends: [], quarterlyTrends: [], insights: [], sources: [],
      warnings: [], generationMode: "local-draft", reviewStatus: "draft",
    };
    saveMemo(legacy);
    const loaded = getMemo("legacy-1");
    assert.equal(loaded?.company.ticker, "EXM");
    assert.equal(loaded?.debtMaturities, undefined);
    assert.equal(loaded?.creditRatings, undefined);
    assert.equal(loaded?.googleTrends, undefined);
  } finally {
    process.chdir(originalCwd);
    rmSync(temp, { recursive: true, force: true });
  }
});
