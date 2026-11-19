import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { EvidenceClaim, FinancialFact, Insight, Memo, Metric, PrivateProfile, Source, TrendPoint } from "./types";

const claim = z.object({ text: z.string().trim().min(3).max(500), sourceIds: z.array(z.string().min(1)).min(1).max(4) });
const funding = z.object({
  stage: z.string().trim().min(2).max(60), announcedAt: z.iso.date().optional(),
  amountUsd: z.number().finite().positive().optional(),
  investors: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  sourceIds: z.array(z.string().min(1)).min(1).max(4),
});
const financialPeriod = z.object({
  label: z.string().trim().min(2).max(40), periodType: z.enum(["annual", "quarterly"]),
  end: z.iso.date(), sourceId: z.string().min(1),
  revenueUsd: z.number().finite().nonnegative().optional(), ebitdaUsd: z.number().finite().optional(),
  cashUsd: z.number().finite().nonnegative().optional(), debtUsd: z.number().finite().nonnegative().optional(),
}).refine((period) => period.revenueUsd !== undefined || period.ebitdaUsd !== undefined ||
  period.cashUsd !== undefined || period.debtUsd !== undefined, "A period needs at least one sourced figure.");
export const privateCompanyInputSchema = z.object({
  company: z.object({ name: z.string().trim().min(2).max(120) }),
  description: claim, industry: claim.optional(), valueProposition: claim.optional(),
  businessDetails: claim.optional(), founders: z.array(claim).max(5).default([]),
  investors: z.array(claim).max(8).default([]), competitors: z.array(claim).max(8).default([]),
  fundingRounds: z.array(funding).max(8).default([]),
  financialPeriods: z.array(financialPeriod).max(5).default([]),
  sources: z.array(z.object({
    id: z.string().trim().min(1).max(40), title: z.string().trim().min(3).max(180),
    url: z.url().refine((value) => {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password;
    }, "Use an HTTPS source URL without credentials."),
    kind: z.enum(["company-website", "company-release", "public-news", "industry", "funding", "founder-profile", "analyst-document"]),
    access: z.enum(["public", "licensed"]).default("public"),
    publishedAt: z.iso.date().optional(), note: z.string().trim().min(3).max(600),
  })).min(1).max(16),
});
export type PrivateCompanyInput = z.input<typeof privateCompanyInputSchema>;
type Input = z.output<typeof privateCompanyInputSchema>;

function validateReferences(input: Input) {
  const known = new Set(input.sources.map((item) => item.id));
  if (known.size !== input.sources.length) throw new Error("Source IDs must be unique.");
  const referenced = [input.description, input.industry, input.valueProposition, input.businessDetails,
    ...input.founders, ...input.investors, ...input.competitors, ...input.fundingRounds]
    .filter((item): item is EvidenceClaim | Input["fundingRounds"][number] => Boolean(item));
  if (referenced.some((item) => item.sourceIds.some((id) => !known.has(id)))) throw new Error("A company claim references an unknown source.");
  if (input.financialPeriods.some((period) => !known.has(period.sourceId))) throw new Error("A financial period references an unknown source.");
  if (new Set(input.financialPeriods.map((period) => period.end)).size !== input.financialPeriods.length) {
    throw new Error("Financial period end dates must be unique.");
  }
}

function calculate(input: Input) {
  const periods = [...input.financialPeriods].sort((a, b) => a.end.localeCompare(b.end));
  const facts: FinancialFact[] = [];
  const trends: TrendPoint[] = [];
  const ids = periods.map((period, index) => {
    const add = (key: "revenueUsd" | "ebitdaUsd" | "cashUsd" | "debtUsd") => {
      const value = period[key];
      if (value === undefined) return null;
      const id = "private-" + key + "-" + period.end;
      facts.push({ id, concept: key, value, unit: "USD", end: period.end,
        form: "Team 1 supplied evidence", filed: period.end, accession: "", sourceId: period.sourceId });
      return id;
    };
    const revenue = add("revenueUsd"), ebitda = add("ebitdaUsd");
    const cash = add("cashUsd"), debt = add("debtUsd");
    const prior = periods[index - 1];
    trends.push({ period: period.label, end: period.end, revenue: period.revenueUsd ?? null,
      ebitda: period.ebitdaUsd ?? null,
      revenueYoY: period.periodType === "annual" && prior?.periodType === "annual" &&
        Number(period.end.slice(0, 4)) - Number(prior.end.slice(0, 4)) === 1 &&
        prior.revenueUsd && period.revenueUsd !== undefined ? (period.revenueUsd / prior.revenueUsd - 1) * 100 : null,
      ebitdaYoY: period.periodType === "annual" && prior?.periodType === "annual" &&
        Number(period.end.slice(0, 4)) - Number(prior.end.slice(0, 4)) === 1 &&
        prior.ebitdaUsd && period.ebitdaUsd !== undefined ? (period.ebitdaUsd / prior.ebitdaUsd - 1) * 100 : null,
      revenueFactIds: revenue ? [revenue] : [], ebitdaFactIds: ebitda ? [ebitda] : [] });
    return { revenue, ebitda, cash, debt };
  });
  const latest = periods.at(-1), last = ids.at(-1);
  const metrics: Metric[] = [];
  if (!latest || !last) return { facts, metrics, trends };
  const addMetric = (id: string, label: string, value: number | undefined, unit: Metric["unit"],
    formula: string, factIds: string[], status: Metric["status"]) => {
    if (value === undefined || !Number.isFinite(value) || !factIds.length) return;
    metrics.push({ id, label, period: latest.label, value, unit, formula, inputFactIds: factIds, status });
  };
  addMetric("revenue", "Revenue", latest.revenueUsd, "USD", "Source-reported revenue", last.revenue ? [last.revenue] : [], "reported");
  addMetric("ebitda", "EBITDA", latest.ebitdaUsd, "USD", "Source-reported EBITDA; definition requires review", last.ebitda ? [last.ebitda] : [], "reported");
  addMetric("cash", "Cash", latest.cashUsd, "USD", "Source-reported cash", last.cash ? [last.cash] : [], "reported");
  addMetric("debt", "Debt", latest.debtUsd, "USD", "Source-reported debt", last.debt ? [last.debt] : [], "reported");
  const priorRevenue = periods.at(-2)?.revenueUsd, priorId = ids.at(-2)?.revenue;
  const prior = periods.at(-2);
  const comparableAnnual = latest.periodType === "annual" && prior?.periodType === "annual" &&
    Number(latest.end.slice(0, 4)) - Number(prior.end.slice(0, 4)) === 1;
  if (comparableAnnual && latest.revenueUsd !== undefined && priorRevenue && priorId && last.revenue) {
    addMetric("revenue-growth", "Revenue growth", (latest.revenueUsd / priorRevenue - 1) * 100,
      "percent", "Current / prior reported revenue - 1", [priorId, last.revenue], "calculated");
  }
  if (latest.periodType === "annual" && latest.debtUsd !== undefined && latest.ebitdaUsd &&
    latest.ebitdaUsd > 0 && last.debt && last.ebitda) {
    addMetric("leverage", "Gross leverage", latest.debtUsd / latest.ebitdaUsd,
      "multiple", "Debt / reported EBITDA; screening measure", [last.debt, last.ebitda], "calculated");
  }
  return { facts, metrics, trends };
}

const aiSchema = z.object({ insights: z.array(z.object({
  kind: z.enum(["performance", "credit", "growth", "risk", "context"]),
  text: z.string().min(1).max(500), evidenceIds: z.array(z.string()).min(1),
})).min(1).max(5) });

async function generatePrivateInsights(profile: PrivateProfile, sources: Source[]) {
  const fallback: Insight[] = [{ id: crypto.randomUUID(), kind: "context",
    text: profile.description.text, evidenceIds: profile.description.sourceIds, reviewed: false }];
  const latestRound = profile.fundingRounds.at(-1);
  if (latestRound) fallback.push({ id: crypto.randomUUID(), kind: "growth",
    text: latestRound.stage + " financing" + (latestRound.amountUsd ? " of $" + (latestRound.amountUsd / 1e6).toFixed(1) + "M" : "") +
      " is documented. Use of proceeds requires separate evidence.",
    evidenceIds: latestRound.sourceIds, reviewed: false });
  const publicSources = sources.filter((item) => item.access === "public");
  const allowed = new Set(publicSources.map((item) => item.id));
  if (!process.env.OPENAI_API_KEY || !profile.description.sourceIds.every((id) => allowed.has(id))) {
    return { insights: fallback, mode: "local-draft" as const,
      warning: "AI drafting uses public evidence only; local source-backed observations were used." };
  }
  const publicClaims = [profile.description, profile.industry, profile.valueProposition, profile.businessDetails,
    ...profile.founders, ...profile.investors, ...profile.competitors]
    .filter((item): item is EvidenceClaim => Boolean(item))
    .filter((item) => item.sourceIds.every((id) => allowed.has(id)));
  const publicRounds = profile.fundingRounds.filter((round) => round.sourceIds.every((id) => allowed.has(id)));
  try {
    const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses.parse({
      model: process.env.OPENAI_MODEL || "gpt-6-astra", store: false,
      input: [
        { role: "system", content: "Draft 1 to 5 concise private-company research observations using only supplied PUBLIC source notes and claims. Cite exact source IDs. Never invent financial figures, investors, causes, or an underwriting decision. Only state a cause if a source note explicitly supports it. No licensed data is supplied." },
        { role: "user", content: JSON.stringify({ claims: publicClaims, rounds: publicRounds,
          sources: publicSources.map(({ id, title, note, publishedAt, url }) => ({ id, title, note, publishedAt, url })) }) },
      ],
      text: { format: zodTextFormat(aiSchema, "private_company_insights") },
    });
    const parsed = response.output_parsed;
    if (!parsed?.insights.length || parsed.insights.some((item) => item.evidenceIds.some((id) => !allowed.has(id)))) {
      throw new Error("AI commentary lacked valid public citations.");
    }
    return { mode: "openai" as const, insights: parsed.insights.map((item) => ({
      id: crypto.randomUUID(), kind: item.kind, text: item.text.trim(),
      evidenceIds: [...new Set(item.evidenceIds)], reviewed: false,
    })) };
  } catch {
    return { mode: "local-draft" as const, insights: fallback,
      warning: "AI commentary was unavailable; source-backed local observations were used." };
  }
}

export async function buildPrivateMemo(raw: unknown): Promise<Memo> {
  const input = privateCompanyInputSchema.parse(raw);
  validateReferences(input);
  const sources: Source[] = input.sources.map((item) => ({ ...item, provenance: "team1", reviewed: false }));
  const profile: PrivateProfile = {
    description: input.description, industry: input.industry, valueProposition: input.valueProposition,
    businessDetails: input.businessDetails, founders: input.founders, investors: input.investors,
    competitors: input.competitors, fundingRounds: input.fundingRounds,
  };
  const { facts, metrics, trends } = calculate(input);
  const generated = await generatePrivateInsights(profile, sources);
  const latest = [...input.financialPeriods].sort((a, b) => a.end.localeCompare(b.end)).at(-1);
  return {
    id: crypto.randomUUID(), company: { name: input.company.name, ticker: "PRIVATE", cik: "",
      kind: "private", description: input.description.text },
    generatedAt: new Date().toISOString(), periodLabel: latest?.label ?? "Evidence snapshot",
    facts, metrics, annualTrends: trends, quarterlyTrends: [], insights: generated.insights,
    sources, privateProfile: profile,
    warnings: [...(generated.warning ? [generated.warning] : []),
      ...(metrics.length ? [] : ["No supported financial figures were supplied; financial measures are omitted."])],
    generationMode: generated.mode, reviewStatus: "draft",
  };
}
