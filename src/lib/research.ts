import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { PublicSourceInput, Source } from "./types";

export function publicationDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : /^\d{8}T\d{6}Z$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "";
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > new Date().toISOString().slice(0, 10)) {
    throw new Error("Public research sources need a valid publication date on or before today (YYYY-MM-DD).");
  }
  return date;
}

export function normalizePublicSources(inputs: PublicSourceInput[]): Source[] {
  const seen = new Set<string>();
  return inputs.slice(0, 8).map((input) => {
    const url = new URL(input.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Research source URLs must use HTTP or HTTPS.");
    if (url.username || url.password) throw new Error("Research source URLs cannot contain credentials.");
    if (!input.title.trim() || !input.note.trim()) throw new Error("Every research source needs a title and a short evidence note.");
    const publishedAt = publicationDate(input.publishedAt ?? "");
    if (seen.has(url.href)) throw new Error("The same research source was added more than once.");
    seen.add(url.href);
    return {
      id: `public:${createHash("sha256").update(url.href).digest("hex").slice(0, 12)}`,
      title: input.title.trim().slice(0, 160),
      url: url.href,
      kind: input.kind,
      access: "public" as const,
      provenance: "analyst-supplied" as const,
      reviewed: false,
      publishedAt,
      note: input.note.trim().slice(0, 800),
    };
  });
}

export type NewsCandidate = { title: string; url: string; publishedAt: string; domain: string };

function candidate(title: string, url: string, rawDate: string, domain: string): NewsCandidate | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return { title: title.trim(), url: parsed.href, publishedAt: publicationDate(rawDate), domain: domain.trim() || parsed.hostname };
  } catch { return null; }
}

function uniqueCandidates(candidates: (NewsCandidate | null)[]): NewsCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((item): item is NewsCandidate => {
    if (!item || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 25);
}

export async function discoverNews(companyName: string): Promise<NewsCandidate[]> {
  const query = `"${companyName.replaceAll('"', "").slice(0, 70)}"`;
  const params = new URLSearchParams({ query, mode: "artlist", format: "json", maxrecords: "25", timespan: "3months" });
  try {
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`GDELT returned ${response.status}`);
    const raw = (await response.json()) as { articles?: { title?: string; url?: string; seendate?: string; domain?: string }[] };
    const candidates = uniqueCandidates((raw.articles ?? [])
      .filter((article) => article.title && article.url)
      .map((article) => candidate(article.title!, article.url!, article.seendate ?? "", article.domain ?? "")));
    if (candidates.length) return candidates;
  } catch {
    // A public RSS feed keeps candidate discovery usable when GDELT is rate limited.
  }
  const rss = new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" });
  const response = await fetch(`https://news.google.com/rss/search?${rss}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`News discovery is temporarily unavailable (${response.status}). Add a public source manually.`);
  const parsed = new XMLParser().parse(await response.text()) as {
    rss?: { channel?: { item?: Array<{ title?: string; link?: string; pubDate?: string; source?: string | { "#text"?: string } }> } };
  };
  const items = parsed.rss?.channel?.item ?? [];
  return uniqueCandidates(items.filter((item) => item.title && item.link).map((item) => candidate(
    item.title!, item.link!, item.pubDate && !Number.isNaN(Date.parse(item.pubDate))
      ? new Date(item.pubDate).toISOString().slice(0, 10) : "",
    typeof item.source === "string" ? item.source : item.source?.["#text"] ?? "Google News",
  )));
}
