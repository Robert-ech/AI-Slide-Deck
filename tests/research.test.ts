import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicSources, publicationDate } from "../src/lib/research";

test("public source dates accept ISO days and GDELT timestamps", () => {
  assert.equal(publicationDate("2026-10-20"), "2026-10-20");
  assert.equal(publicationDate("20261020T123045Z"), "2026-10-20");
  assert.throws(() => publicationDate("2026-02-30"), /valid publication date/);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assert.throws(() => publicationDate(tomorrow), /valid publication date/);
});

test("analyst-added news keeps its date and starts unreviewed", () => {
  const [source] = normalizePublicSources([{
    title: "Company update", url: "https://example.com/article", publishedAt: "2026-10-20",
    note: "The company announced an expansion.", kind: "public-news",
  }]);
  assert.equal(source.publishedAt, "2026-10-20");
  assert.equal(source.provenance, "analyst-supplied");
  assert.equal(source.reviewed, false);
  assert.equal(source.access, "public");
});

test("public research rejects undated, repeated, and credential-bearing sources", () => {
  const input = { title: "Article", url: "https://example.com/news", publishedAt: "2026-10-20", note: "Verified fact.", kind: "public-news" as const };
  assert.throws(() => normalizePublicSources([{ ...input, publishedAt: "" }]), /publication date/);
  assert.throws(() => normalizePublicSources([input, input]), /more than once/);
  assert.throws(() => normalizePublicSources([{ ...input, url: "https://person:secret@example.com/news" }]), /credentials/);
});
