import type { Insight, Source } from "./types";

/** SEC filing links are primary evidence; analyst-added and publisher sources need a check. */
export function sourceIsReviewed(source: Source): boolean {
  return source.kind === "filing" && source.provenance !== "analyst-supplied" || source.reviewed === true;
}

export function reviewProblem(insights: Insight[], sources: Source[]): string | null {
  if (!insights.length) return "Add at least one source-backed insight before marking the memo reviewed.";
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const insight of insights) {
    if (!insight.reviewed) return "Review every insight before marking the memo reviewed.";
    if (!insight.evidenceIds.length) return "Every insight needs a source citation.";
    for (const id of insight.evidenceIds) {
      const source = byId.get(id);
      if (!source) return `An insight references an unknown source (${id}).`;
      if (!sourceIsReviewed(source)) return `Review the cited source “${source.title}” before marking the memo reviewed.`;
    }
  }
  return null;
}
