import { z } from "zod";
import { assertCompanyIdentity, attachEvidenceSource, sourceInputSchema } from "./evidence";
import type { GoogleTrendsPoint, Memo } from "./types";

const isoDate = z.iso.date();

export const trendsInputSchema = z.object({
  ticker: z.string().trim().min(1).max(12),
  csv: z.string().min(20).max(150_000),
  query: z.string().trim().min(1).max(100),
  /** Use the geography label in the export, such as "United States". */
  geography: z.string().trim().min(2).max(100),
  periodStart: isoDate,
  periodEnd: isoDate,
  retrievedAt: isoDate,
  reviewed: z.boolean(),
  source: sourceInputSchema.extend({ access: z.literal("public") }),
}).strict().superRefine((value, ctx) => {
  if (value.periodStart > value.periodEnd) {
    ctx.addIssue({ code: "custom", message: "Trend period starts after it ends.", path: ["periodStart"] });
  }
  if (value.periodEnd > value.retrievedAt) {
    ctx.addIssue({ code: "custom", message: "Trend period ends after retrieval date.", path: ["retrievedAt"] });
  }
  try {
    const url = new URL(value.source.url);
    if (url.hostname !== "trends.google.com" || !url.pathname.startsWith("/trends")) {
      ctx.addIssue({ code: "custom", message: "Use a Google Trends source URL.", path: ["source", "url"] });
    }
  } catch {
    // The shared source schema reports malformed URLs.
  }
});

function parseCsvRecords(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (!quoted && field === "") {
        quoted = true;
      } else if (quoted) {
        quoted = false;
      } else {
        throw new Error("Malformed Google Trends CSV quoting.");
      }
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Malformed Google Trends CSV quoting.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function intervalFromLabel(label: string): { start: string; end: string } {
  const range = /^(\d{4}-\d{2}-\d{2})\s+-\s+(\d{4}-\d{2}-\d{2})$/.exec(label);
  if (range && z.iso.date().safeParse(range[1]).success && z.iso.date().safeParse(range[2]).success && range[1] <= range[2]) {
    return { start: range[1], end: range[2] };
  }
  if (z.iso.date().safeParse(label).success) return { start: label, end: label };
  const month = /^(\d{4})-(\d{2})$/.exec(label);
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12) {
    const lastDay = new Date(Date.UTC(Number(month[1]), Number(month[2]), 0)).getUTCDate();
    return { start: `${label}-01`, end: `${label}-${String(lastDay).padStart(2, "0")}` };
  }
  const year = /^(\d{4})$/.exec(label);
  if (year) return { start: `${year[1]}-01-01`, end: `${year[1]}-12-31` };
  throw new Error(`Invalid Google Trends date: ${label}.`);
}

export function parseGoogleTrendsCsv(
  csv: string,
  expected: { query: string; geography: string; periodStart: string; periodEnd: string },
): GoogleTrendsPoint[] {
  if (csv.length > 150_000) throw new Error("Google Trends CSV exceeds the 150 KB limit.");
  const rows = parseCsvRecords(csv.replace(/^\uFEFF/, ""));
  const headerIndex = rows.findIndex((row) => /^(day|week|month|year|date)$/i.test(row[0] ?? ""));
  if (headerIndex < 0) throw new Error("Google Trends CSV needs a Day, Week, Month, or Year header.");
  const header = rows[headerIndex];
  if (header.length !== 2) throw new Error("Import one Google Trends query at a time.");
  const label = /^(.*):\s*\(([^)]+)\)$/.exec(header[1]);
  if (!label) throw new Error("Google Trends CSV must identify its query and geography.");
  if (label[1].trim().toLocaleLowerCase() !== expected.query.trim().toLocaleLowerCase()) {
    throw new Error(`CSV query ${label[1].trim()} does not match the selected query.`);
  }
  if (label[2].trim().toLocaleLowerCase() !== expected.geography.trim().toLocaleLowerCase()) {
    throw new Error(`CSV geography ${label[2].trim()} does not match the selected geography.`);
  }
  const points: GoogleTrendsPoint[] = [];
  let previousDate = "";
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.length !== 2) throw new Error("Google Trends CSV has a row with an unexpected number of columns.");
    const interval = intervalFromLabel(row[0]);
    if (interval.start < expected.periodStart || interval.end > expected.periodEnd) {
      throw new Error(`Google Trends date ${row[0]} is outside the stated period.`);
    }
    if (interval.start <= previousDate) throw new Error("Google Trends dates must be unique and ascending.");
    previousDate = interval.start;
    const value = row[1];
    if (value === "" || value === "<1") {
      points.push({ date: interval.start, interest: null, note: value === "<1" ? "Export reports <1; exact value unavailable." : "No value in export." });
    } else if (/^\d{1,3}$/.test(value) && Number(value) <= 100) {
      points.push({ date: interval.start, interest: Number(value) });
    } else {
      throw new Error(`Invalid Google Trends index: ${value}.`);
    }
  }
  if (points.length < 2 || !points.some((point) => point.interest !== null)) {
    throw new Error("Google Trends CSV needs at least two dates and one reported index.");
  }
  return points;
}

export function applyTrendsImport(memo: Memo, raw: unknown): Memo {
  const input = trendsInputSchema.parse(raw);
  assertCompanyIdentity(memo, input.ticker);
  const points = parseGoogleTrendsCsv(input.csv, input);
  const sourceId = attachEvidenceSource(memo, { source: input.source }, "trends", "google-trends-export", input.reviewed);
  memo.googleTrends = {
    query: input.query,
    geography: input.geography,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    retrievedAt: input.retrievedAt,
    sourceId,
    reviewed: input.reviewed,
    points,
  };
  memo.reviewStatus = "draft";
  return memo;
}
