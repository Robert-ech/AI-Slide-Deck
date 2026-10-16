import { NextRequest, NextResponse } from "next/server";
import { discoverNews } from "@/lib/research";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const company = (request.nextUrl.searchParams.get("company") ?? "").trim();
  if (company.length < 3 || company.length > 80) return NextResponse.json({ error: "Enter a company name." }, { status: 400 });
  try {
    return NextResponse.json({ candidates: await discoverNews(company) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "News lookup failed." }, { status: 503 });
  }
}
