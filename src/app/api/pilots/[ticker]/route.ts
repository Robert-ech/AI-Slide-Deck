import { NextRequest, NextResponse } from "next/server";
import { pilotMemo } from "@/lib/pilots";

export async function GET(_request: NextRequest, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const upper = ticker.toUpperCase();
  if (upper !== "WMT" && upper !== "MSFT") return NextResponse.json({ error: "Unknown pilot." }, { status: 404 });
  return NextResponse.json({ memo: pilotMemo(upper) });
}
