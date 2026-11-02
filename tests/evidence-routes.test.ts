import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Memo } from "../src/lib/types";

test("manual evidence routes validate identity and persist imported records", async () => {
  const originalCwd = process.cwd();
  const temp = mkdtempSync(path.join(tmpdir(), "ds3-evidence-routes-"));
  try {
    process.chdir(temp);
    const { saveMemo, getMemo } = await import("../src/lib/db");
    const { POST: postMaturities } = await import("../src/app/api/memos/[id]/maturities/route");
    const { POST: postRatings } = await import("../src/app/api/memos/[id]/ratings/route");
    const { POST: postTrends } = await import("../src/app/api/memos/[id]/trends/route");
    const memo: Memo = {
      id: "route-memo", company: { name: "Microsoft Corporation", ticker: "MSFT", cik: "789019" },
      generatedAt: "2026-10-26T00:00:00.000Z", periodLabel: "FY2026",
      facts: [], metrics: [], annualTrends: [], quarterlyTrends: [], insights: [],
      sources: [{ id: "sec-10k", title: "FY2026 Form 10-K", url: "https://www.sec.gov/Archives/example", kind: "filing", access: "public" }],
      warnings: [], generationMode: "local-draft", reviewStatus: "draft",
    };
    saveMemo(memo);
    const context = { params: Promise.resolve({ id: memo.id }) };
    const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    const wrongCompany = await postMaturities(post("http://localhost/api/memos/route-memo/maturities", {
      ticker: "WMT", asOf: "2026-06-30", basis: "Scheduled principal payments", reviewed: true, sourceId: "sec-10k",
      buckets: [{ label: "FY2027", fiscalYear: 2027, senior: 100, junior: null, unclassified: null }],
    }), context);
    assert.equal(wrongCompany.status, 400);
    assert.equal(getMemo(memo.id)?.debtMaturities, undefined);

    const maturities = await postMaturities(post("http://localhost/api/memos/route-memo/maturities", {
      ticker: "MSFT", asOf: "2026-06-30", basis: "Scheduled principal payments", reviewed: true, sourceId: "sec-10k",
      buckets: [{ label: "FY2027", fiscalYear: 2027, senior: 100, junior: null, unclassified: null }],
    }), context);
    assert.equal(maturities.status, 200);
    assert.equal(getMemo(memo.id)?.debtMaturities?.buckets[0].senior, 100);

    const rating = await postRatings(post("http://localhost/api/memos/route-memo/ratings", {
      ticker: "MSFT", agency: "S&P", rating: "AAA", scope: "Issuer", asOf: "2026-10-20", reviewed: false,
      source: { title: "Agency rating page", url: "https://www.example.com/rating", access: "public" },
    }), context);
    assert.equal(rating.status, 200);
    assert.equal(getMemo(memo.id)?.creditRatings?.[0].rating, "AAA");

    const trends = await postTrends(post("http://localhost/api/memos/route-memo/trends", {
      ticker: "MSFT", query: "Microsoft", geography: "United States",
      periodStart: "2026-01-01", periodEnd: "2026-03-31", retrievedAt: "2026-04-01", reviewed: true,
      csv: "Month,Microsoft: (United States)\n2026-01,42\n2026-02,52\n2026-03,62",
      source: { title: "Google Trends export", url: "https://trends.google.com/trends/explore?q=Microsoft", access: "public" },
    }), context);
    assert.equal(trends.status, 200);
    assert.deepEqual(getMemo(memo.id)?.googleTrends?.points.map((point) => point.interest), [42, 52, 62]);

    const absent = await postRatings(post("http://localhost/api/memos/absent/ratings", {}), { params: Promise.resolve({ id: "absent" }) });
    assert.equal(absent.status, 404);
  } finally {
    process.chdir(originalCwd);
    rmSync(temp, { recursive: true, force: true });
  }
});
