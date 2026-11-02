import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { Insight, Metric, Source, TrendPoint } from "./types";

const InsightSchema = z.object({
  insights: z.array(z.object({
    kind: z.enum(["performance", "credit", "growth", "risk", "context"]),
    text: z.string(),
    evidenceIds: z.array(z.string()),
  })).max(5),
});

function sourceIdsFor(metric: Metric, factSource: Map<string, string>): string[] {
  return [...new Set(metric.inputFactIds.map((id) => factSource.get(id)).filter((id): id is string => Boolean(id)))];
}

export function fallbackInsights(
  metrics: Metric[], sources: Source[], annual: TrendPoint[], factSource: Map<string, string>,
): Insight[] {
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  const growth = byId.get("revenue-growth");
  const leverage = byId.get("leverage");
  const cash = byId.get("cash");
  const latest = annual.at(-1);
  const insights: Insight[] = [];
  const growthEvidence = growth ? sourceIdsFor(growth, factSource) : [];
  if (growth?.value != null && growthEvidence.length) insights.push({
      id: crypto.randomUUID(), kind: "performance",
      text: `Revenue ${growth.value >= 0 ? "increased" : "decreased"} ${Math.abs(growth.value).toFixed(1)}% in ${latest?.period ?? growth.period}. The cause still needs source-backed research.`,
      evidenceIds: growthEvidence, reviewed: false,
    });
  const leverageEvidence = leverage ? sourceIdsFor(leverage, factSource) : [];
  if (leverage?.value != null && leverageEvidence.length) insights.push({
      id: crypto.randomUUID(), kind: "credit",
      text: `${leverage.label} is ${leverage.value.toFixed(2)}×, based on ${leverage.formula.toLowerCase()}. This is a screening ratio, not a covenant measure.`,
      evidenceIds: leverageEvidence, reviewed: false,
    });
  const cashEvidence = cash ? sourceIdsFor(cash, factSource) : [];
  if (cash?.value != null && cashEvidence.length) insights.push({
      id: crypto.randomUUID(), kind: "risk",
      text: `Cash and equivalents were $${(cash.value / 1e9).toFixed(1)}B at ${cash.period}. Available credit facilities and restrictions require separate review.`,
      evidenceIds: cashEvidence, reviewed: false,
    });
  for (const source of sources.filter((item) => item.access === "public" && item.note && item.publishedAt).slice(0, 2)) {
    insights.push({
      id: crypto.randomUUID(), kind: "context", text: `${source.note!.trim()} (${source.publishedAt})`,
      evidenceIds: [source.id], reviewed: false,
    });
  }
  return insights;
}

export async function generateInsights(
  metrics: Metric[], sources: Source[], annual: TrendPoint[], factSource: Map<string, string>,
): Promise<{ insights: Insight[]; mode: "openai" | "local-draft"; warning?: string }> {
  const fallback = fallbackInsights(metrics, sources, annual, factSource);
  if (!process.env.OPENAI_API_KEY) {
    return { insights: fallback, mode: "local-draft", warning: "OPENAI_API_KEY is not set; the memo contains editable local draft observations." };
  }
  const publicSources = sources.filter((source) => source.access === "public");
  const allowedIds = new Set(publicSources.map((source) => source.id));
  const publicMetrics = metrics.map((metric) => ({
    id: metric.id, label: metric.label, period: metric.period, value: metric.value, unit: metric.unit,
    formula: metric.formula, status: metric.status, evidenceIds: sourceIdsFor(metric, factSource),
  }));
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.parse({
      model: process.env.OPENAI_MODEL || "gpt-6-astra",
      store: false,
      input: [
        {
          role: "system",
          content: "Draft 3 to 5 concise banker-style credit research insights using only supplied PUBLIC evidence. Never infer a causal driver unless an evidence note states it. Do not make an underwriting decision. Use source IDs exactly as supplied. If data is missing, say so. Distinguish estimated EBITDA and leverage from covenant measures. Each insight must include at least one source ID unless it explicitly states missing data. No IBISWorld content is included or permitted.",
        },
        {
          role: "user",
          content: JSON.stringify({ metrics: publicMetrics, annualTrends: annual, sources: publicSources.map(({ id, title, url, publishedAt, note }) => ({ id, title, url, publishedAt, note })) }),
        },
      ],
      text: { format: zodTextFormat(InsightSchema, "credit_memo_insights") },
    });
    const parsed = response.output_parsed;
    if (!parsed) throw new Error("No structured insights were returned.");
    const insights = parsed.insights.map((item) => ({
      id: crypto.randomUUID(), kind: item.kind, text: item.text.trim(),
      evidenceIds: [...new Set(item.evidenceIds)].filter((id) => allowedIds.has(id)), reviewed: false,
    }));
    if (!insights.length && fallback.length) throw new Error("AI returned no cited insights for available evidence.");
    if (insights.some((item) => !item.text || !item.evidenceIds.length)) {
      throw new Error("At least one insight lacked traceable public evidence.");
    }
    return { insights, mode: "openai" };
  } catch (error) {
    return {
      insights: fallback,
      mode: "local-draft",
      warning: `AI draft was unavailable; local observations were used. ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
