import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { Insight, Metric, Source, TrendPoint } from "./types";

const InsightSchema = z.object({
  insights: z.array(z.object({
    kind: z.enum(["performance", "credit", "growth", "risk", "context"]),
    text: z.string(),
    evidenceIds: z.array(z.string()),
  })).min(3).max(5),
});

function sourceIdsFor(metric: Metric, factSource: Map<string, string>): string[] {
  return [...new Set(metric.inputFactIds.map((id) => factSource.get(id)).filter((id): id is string => Boolean(id)))];
}

export function fallbackInsights(
  metrics: Metric[], sources: Source[], annual: TrendPoint[], factSource: Map<string, string>,
): Insight[] {
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  const growth = byId.get("revenue-growth")!;
  const leverage = byId.get("leverage")!;
  const cash = byId.get("cash")!;
  const latest = annual.at(-1);
  const firstFiling = sources.find((source) => source.kind === "filing")?.id;
  const evidence = (metric: Metric) => sourceIdsFor(metric, factSource).length
    ? sourceIdsFor(metric, factSource) : firstFiling ? [firstFiling] : [];
  const insights: Insight[] = [
    {
      id: crypto.randomUUID(), kind: "performance",
      text: growth.value === null
        ? "Annual revenue growth could not be verified from standardized filings. Review the underlying filing before drawing a trend conclusion."
        : `Revenue ${growth.value >= 0 ? "increased" : "decreased"} ${Math.abs(growth.value).toFixed(1)}% in ${latest?.period}. The cause still needs source-backed research.`,
      evidenceIds: evidence(growth), reviewed: false,
    },
    {
      id: crypto.randomUUID(), kind: "credit",
      text: leverage.value === null
        ? "Gross leverage is unavailable from aligned debt and EBITDA inputs; no debt-capacity conclusion is made."
        : `Estimated gross leverage is ${leverage.value.toFixed(2)}×. This is not a covenant-defined ratio and requires analyst review.`,
      evidenceIds: evidence(leverage), reviewed: false,
    },
    {
      id: crypto.randomUUID(), kind: "risk",
      text: cash.value === null
        ? "Cash and equivalents could not be mapped from standardized facts; liquidity requires filing review."
        : `Cash and equivalents were $${(cash.value / 1e9).toFixed(1)}B at ${cash.period}. Available credit facilities and restrictions are not captured here.`,
      evidenceIds: evidence(cash), reviewed: false,
    },
  ];
  const publicContext = sources.find((source) => source.access === "public" && source.note);
  if (publicContext) insights.push({
    id: crypto.randomUUID(), kind: "context", text: publicContext.note!, evidenceIds: [publicContext.id], reviewed: false,
  });
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
