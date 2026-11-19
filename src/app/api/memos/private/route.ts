import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveMemo } from "@/lib/db";
import { buildPrivateMemo } from "@/lib/private-memo";
import { guardLocalMutation } from "@/lib/local-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const blocked = guardLocalMutation(request, "json");
  if (blocked) return blocked;
  try {
    const memo = await buildPrivateMemo(await request.json());
    saveMemo(memo);
    return NextResponse.json({ memo }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Private memo generation failed." },
      { status: error instanceof z.ZodError ? 400 : 400 });
  }
}
