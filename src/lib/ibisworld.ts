import type { IndustryContext } from "./types";

let tokenCache: { token: string; expiresAt: number } | undefined;

function configured(): boolean {
  return Boolean(process.env.IBISWORLD_CLIENT_ID && process.env.IBISWORLD_USERNAME && process.env.IBISWORLD_PASSWORD);
}

export function ibisConfigured(): boolean { return configured(); }

async function token(): Promise<string> {
  if (!configured()) throw new Error("Set IBISWORLD_CLIENT_ID, IBISWORLD_USERNAME, and IBISWORLD_PASSWORD in .env.local.");
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const response = await fetch("https://api.ibisworld.com/authentication/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ClientId: process.env.IBISWORLD_CLIENT_ID,
      Username: process.env.IBISWORLD_USERNAME,
      Password: process.env.IBISWORLD_PASSWORD,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`IBISWorld authentication failed (${response.status}).`);
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("IBISWorld did not return an access token.");
  tokenCache = { token: body.access_token, expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000 };
  return body.access_token;
}

function textFor(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textFor).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record.Text, record.Value, record.Analysis, record.Summary, record.Content].map(textFor).find(Boolean) ?? "";
  }
  return "";
}

function field(body: Record<string, unknown>, key: string): unknown {
  const match = Object.keys(body).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return match ? body[match] : undefined;
}

export async function getIndustryContext(reportCode: string): Promise<IndustryContext> {
  if (process.env.IBISWORLD_LICENSE_CONFIRMED !== "true") {
    throw new Error("Confirm your IBISWorld account permits API retrieval and local display, then set IBISWORLD_LICENSE_CONFIRMED=true in .env.local.");
  }
  if (!/^[A-Za-z0-9.\-]{2,24}$/.test(reportCode)) throw new Error("Enter a valid IBISWorld report code.");
  const response = await fetch("https://api.ibisworld.com/industry/v3/sections", {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      Country: "US", Code: reportCode, Language: "English",
      ReportSections: ["Title", "PublicationDate", "CurrentPerformanceAnalysis", "OutlookAnalysis"],
      AllYears: false,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`IBISWorld report request failed (${response.status}). Check the report code and license.`);
  const body = (await response.json()) as Record<string, unknown>;
  const title = textFor(field(body, "Title")) || `IBISWorld report ${reportCode}`;
  const performance = textFor(field(body, "CurrentPerformanceAnalysis"));
  const outlook = textFor(field(body, "OutlookAnalysis"));
  return {
    reportCode,
    reportTitle: title,
    publicationDate: textFor(field(body, "PublicationDate")) || undefined,
    summary: [performance, outlook].filter(Boolean).join("\n\n").slice(0, 2500) || "Report connected. Open IBISWorld to review its industry analysis.",
    sourceId: `ibis:${reportCode}`,
  };
}
