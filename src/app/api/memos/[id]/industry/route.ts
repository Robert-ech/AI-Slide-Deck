import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMemo, saveMemo } from "@/lib/db";
import { getIndustryContext } from "@/lib/ibisworld";
import { guardLocalMutation } from "@/lib/local-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guardLocalMutation(request, "json");
  if (blocked) return blocked;
  try {
    const { id } = await context.params;
    const memo = getMemo(id);
    if (!memo) return NextResponse.json({ error: "Memo not found." }, { status: 404 });
    const { reportCode } = z.object({ reportCode: z.string().min(2).max(24) }).parse(await request.json());
    const industry = await getIndustryContext(reportCode);
    memo.industry = industry;
    memo.sources = memo.sources.filter((source) => source.kind !== "industry");
    memo.sources.push({
      id: industry.sourceId,
      title: `${industry.reportTitle} (IBISWorld ${reportCode})`,
      url: "https://www.ibisworld.com/",
      kind: "industry",
      access: "licensed",
      publishedAt: industry.publicationDate,
    });
    memo.reviewStatus = "draft";
    saveMemo(memo);
    return NextResponse.json({ memo });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Industry lookup failed." }, { status: 503 });
  }
}
