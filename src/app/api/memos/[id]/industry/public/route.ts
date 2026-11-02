import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMemo, saveMemo } from "@/lib/db";
import { isValidEvidenceUrl } from "@/lib/evidence";
import { guardLocalMutation } from "@/lib/local-request";
import { publicationDate } from "@/lib/research";

export const runtime = "nodejs";

const Input = z.object({
  title: z.string().trim().min(3).max(180),
  url: z.string().trim().max(2048).refine(isValidEvidenceUrl, "Use a public HTTPS source URL."),
  publishedAt: z.iso.date(),
  summary: z.string().trim().min(40).max(1200),
  reviewed: z.literal(true),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guardLocalMutation(request, "json");
  if (blocked) return blocked;
  const { id } = await context.params;
  const memo = getMemo(id);
  if (!memo) return NextResponse.json({ error: "Memo not found." }, { status: 404 });
  try {
    const input = Input.parse(await request.json());
    const publishedAt = publicationDate(input.publishedAt);
    const sourceId = `public-industry:${randomUUID()}`;
    const cited = new Set(memo.insights.flatMap((insight) => insight.evidenceIds));
    memo.sources = memo.sources.filter((source) => source.kind !== "industry" || cited.has(source.id));
    memo.sources.push({
      id: sourceId, title: input.title, url: input.url, kind: "industry", access: "public",
      provenance: "analyst-supplied", reviewed: true, reviewedAt: new Date().toISOString(), publishedAt,
      note: "Analyst-checked public industry reference.",
    });
    memo.industry = {
      reportCode: "PUBLIC", reportTitle: input.title, publicationDate: publishedAt,
      summary: input.summary, sourceId,
    };
    memo.reviewStatus = "draft";
    saveMemo(memo);
    return NextResponse.json({ memo });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Industry import failed." }, { status: 400 });
  }
}
