import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getMemo, saveMemo } from "@/lib/db";
import { applyRatingImport } from "@/lib/evidence";
import { guardLocalMutation } from "@/lib/local-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guardLocalMutation(request, "json");
  if (blocked) return blocked;
  const { id } = await context.params;
  const memo = getMemo(id);
  if (!memo) return NextResponse.json({ error: "Memo not found." }, { status: 404 });
  try {
    const updated = applyRatingImport(memo, await request.json());
    saveMemo(updated);
    return NextResponse.json({ memo: updated });
  } catch (error) {
    const message = error instanceof ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Rating import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
