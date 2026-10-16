import { NextRequest, NextResponse } from "next/server";
import { getCompanies } from "@/lib/sec";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim().toUpperCase();
    if (query.length < 1) return NextResponse.json({ companies: [] });
    const companies = (await getCompanies())
      .filter((company) => company.ticker.startsWith(query) || company.name.toUpperCase().includes(query))
      .slice(0, 12);
    return NextResponse.json({ companies });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Company lookup failed." }, { status: 503 });
  }
}
