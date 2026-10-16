import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { PublicSourceInput, Source } from "./types";

export function normalizePublicSources(inputs: PublicSourceInput[]): Source[] {
  return inputs.slice(0, 8).map((input) => {
    const url = new URL(input.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Research source URLs must use HTTP or HTTPS.");
    if (!input.title.trim() || !input.note.trim()) throw new Error("Every research source needs a title and a short evidence note.");
    return {
      id: `public:${createHash("sha256").update(url.href).digest("hex").slice(0, 12)}`,
      title: input.title.trim().slice(0, 160),
      url: url.href,
      kind: input.kind,
      access: "public" as const,
      publishedAt: input.publishedAt || undefined,
      note: input.note.trim().slice(0, 800),
    };
  });
}

export type NewsCandidate = { title: string; url: string; publishedAt: string; domain: string };

export async function discoverNews(companyName: string): Promise<NewsCandidate[]> {
  const query = `"${companyName.replaceAll('"', "").slice(0, 70)}"`;
  const params = new URLSearchParams({ query, mode: "artlist", format: "json", maxrecords: "25", timespan: "3months" });
  try {
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`GDELT returned ${response.status}`);
    const raw = (await response.json()) as { articles?: { title?: string; url?: string; seendate?: string; domain?: string }[] };
    const candidates = (raw.articles ?? [])
      .filter((article) => article.title && article.url)
      .map((article) => ({
        title: article.title!, url: article.url!, publishedAt: article.seendate ?? "", domain: article.domain ?? "",
      }));
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
  return items.slice(0, 25).filter((item) => item.title && item.link?.startsWith("https://"))
    .map((item) => ({
      title: item.title!, url: item.link!, publishedAt: item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : "",
      domain: typeof item.source === "string" ? item.source : item.source?.["#text"] ?? "Google News",
    }));
}
