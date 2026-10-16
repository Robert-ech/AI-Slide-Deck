import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMemo, saveMemo } from "@/lib/db";

export const runtime = "nodejs";

const Update = z.object({
  insights: z.array(z.object({
    id: z.string(), kind: z.enum(["performance", "credit", "growth", "risk", "context"]),
    text: z.string().trim().min(1).max(600), evidenceIds: z.array(z.string()).min(1), reviewed: z.boolean(),
  })).min(1).max(8).optional(),
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
    if (update.insights) {
      memo.insights = update.insights;
      memo.reviewStatus = "draft";
    }
    if (update.reviewStatus === "reviewed") {
      if (memo.insights.some((insight) => !insight.reviewed)) {
        return NextResponse.json({ error: "Review every insight before marking the memo reviewed." }, { status: 400 });
      }
      memo.reviewStatus = "reviewed";
    } else if (update.reviewStatus) {
      memo.reviewStatus = update.reviewStatus;
    }
    saveMemo(memo);
    return NextResponse.json({ memo });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed." }, { status: 400 });
  }
}
