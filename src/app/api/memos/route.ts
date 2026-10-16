import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildFinancials } from "@/lib/financials";
import { listMemos, saveMemo } from "@/lib/db";
import { generateInsights } from "@/lib/insights";
import { normalizePublicSources } from "@/lib/research";
import { getSecBundle } from "@/lib/sec";
import type { Memo } from "@/lib/types";

export const runtime = "nodejs";

const SourceInput = z.object({
  title: z.string().min(1).max(160),
  url: z.url(),
  publishedAt: z.string().optional(),
  note: z.string().min(1).max(800),
  kind: z.enum(["public-news", "company-release"]),
});
const RequestSchema = z.object({
  ticker: z.string().trim().min(1).max(8).regex(/^[A-Za-z.-]+$/),
  publicSources: z.array(SourceInput).max(8).default([]),
});

export async function GET() {
  return NextResponse.json({ memos: listMemos() });
}

export async function POST(request: NextRequest) {
  try {
    const input = RequestSchema.parse(await request.json());
    const bundle = await getSecBundle(input.ticker);
    const financials = buildFinancials(bundle.company.cik, bundle.facts, bundle.submissions);
    const publicSources = normalizePublicSources(input.publicSources);
    const sources = [...financials.sources, ...publicSources];
    const factSource = new Map(financials.facts.map((fact) => [fact.id, fact.sourceId]));
    const generated = await generateInsights(financials.metrics, sources, financials.annualTrends, factSource);
    const memo: Memo = {
      id: crypto.randomUUID(),
      company: {
        ...bundle.company,
        description: bundle.submissions.sicDescription || undefined,
      },
      generatedAt: new Date().toISOString(),
      periodLabel: financials.periodLabel,
      facts: financials.facts,
      metrics: financials.metrics,
      annualTrends: financials.annualTrends,
      quarterlyTrends: financials.quarterlyTrends,
      insights: generated.insights,
      sources,
      warnings: [...financials.warnings, ...(generated.warning ? [generated.warning] : [])],
      generationMode: generated.mode,
      reviewStatus: "draft",
    };
    saveMemo(memo);
    return NextResponse.json({ memo }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Memo generation failed.";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}
