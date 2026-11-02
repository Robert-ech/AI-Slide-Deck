import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMemo, saveMemo } from "@/lib/db";
import { reviewProblem } from "@/lib/review";

export const runtime = "nodejs";

const Update = z.object({
  insights: z.array(z.object({
    id: z.string(), kind: z.enum(["performance", "credit", "growth", "risk", "context"]),
    text: z.string().trim().min(1).max(600), evidenceIds: z.array(z.string()).min(1), reviewed: z.boolean(),
  })).min(1).max(8).optional(),
  sourceReviews: z.array(z.object({ id: z.string().min(1), reviewed: z.boolean() })).max(30).optional(),
  reviewStatus: z.enum(["draft", "reviewed"]).optional(),
});

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const memo = getMemo(id);
  return memo ? NextResponse.json({ memo }) : NextResponse.json({ error: "Memo not found." }, { status: 404 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const memo = getMemo(id);
    if (!memo) return NextResponse.json({ error: "Memo not found." }, { status: 404 });
    const update = Update.parse(await request.json());
    const allowedEvidence = new Set(memo.sources.map((source) => source.id));
    if (update.insights?.some((insight) => insight.evidenceIds.some((sourceId) => !allowedEvidence.has(sourceId)))) {
      return NextResponse.json({ error: "An insight references an unknown source." }, { status: 400 });
    }
    if (update.sourceReviews) {
      const ids = update.sourceReviews.map((item) => item.id);
      if (new Set(ids).size !== ids.length) return NextResponse.json({ error: "Each source can be reviewed once per update." }, { status: 400 });
      for (const item of update.sourceReviews) {
        const source = memo.sources.find((candidate) => candidate.id === item.id);
        if (!source || source.kind === "filing" || source.provenance !== "analyst-supplied") {
          return NextResponse.json({ error: `Source ${item.id} is not eligible for analyst review.` }, { status: 400 });
        }
      }
    }
    const nextSources = memo.sources.map((source) => {
      const updateReview = update.sourceReviews?.find((item) => item.id === source.id);
      return updateReview ? { ...source, reviewed: updateReview.reviewed,
        reviewedAt: updateReview.reviewed ? new Date().toISOString() : undefined } : source;
    });
    const nextInsights = update.insights ?? memo.insights;
    if (update.reviewStatus === "reviewed") {
      const problem = reviewProblem(nextInsights, nextSources);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }
    memo.insights = nextInsights;
    memo.sources = nextSources;
    memo.reviewStatus = update.reviewStatus ?? (update.insights || update.sourceReviews ? "draft" : memo.reviewStatus);
    saveMemo(memo);
    return NextResponse.json({ memo });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed." }, { status: 400 });
  }
}
