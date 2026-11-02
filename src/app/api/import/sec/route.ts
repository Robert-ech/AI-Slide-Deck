import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CompanyFacts, Submissions } from "@/lib/sec";
import { guardLocalMutation } from "@/lib/local-request";

export const runtime = "nodejs";

const CIKS: Record<string, number> = { WMT: 104169, MSFT: 789019 };

export async function POST(request: NextRequest) {
  const blocked = guardLocalMutation(request, "multipart");
  if (blocked) return blocked;
  try {
    const form = await request.formData();
    const ticker = String(form.get("ticker") ?? "").toUpperCase();
    const factsFile = form.get("facts");
    const submissionsFile = form.get("submissions");
    if (!(ticker in CIKS) || !(factsFile instanceof File) || !(submissionsFile instanceof File)) {
      return NextResponse.json({ error: "Choose WMT or MSFT and both official SEC JSON files." }, { status: 400 });
    }
    if (factsFile.size > 35_000_000 || submissionsFile.size > 15_000_000) {
      return NextResponse.json({ error: "One of the files is unexpectedly large." }, { status: 400 });
    }
    const [factsText, submissionsText] = await Promise.all([factsFile.text(), submissionsFile.text()]);
    const facts = JSON.parse(factsText) as CompanyFacts;
    const submissions = JSON.parse(submissionsText) as Submissions;
    if (facts.cik !== CIKS[ticker] || !facts.facts?.["us-gaap"] ||
      !Array.isArray(submissions.filings?.recent?.accessionNumber) ||
      !Array.isArray(submissions.filings?.recent?.primaryDocument) ||
      submissions.filings.recent.accessionNumber.length !== submissions.filings.recent.primaryDocument.length ||
      Number(submissions.cik) !== CIKS[ticker]) {
      return NextResponse.json({ error: "The JSON files do not match the selected company or SEC data format." }, { status: 400 });
    }
    const directory = path.join(process.cwd(), "data", "sec");
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(path.join(directory, `${ticker}-facts.json`), factsText, { mode: 0o600 }),
      writeFile(path.join(directory, `${ticker}-submissions.json`), submissionsText, { mode: 0o600 }),
    ]);
    return NextResponse.json({ ok: true, ticker });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SEC import failed." }, { status: 400 });
  }
}
