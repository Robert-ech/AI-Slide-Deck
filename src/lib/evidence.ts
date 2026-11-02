import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CreditRating, DebtMaturitySchedule, Memo, Source } from "./types";

const isoDate = z.iso.date();
const nonNegativeAmount = z.number().finite().nonnegative().nullable();
const today = () => new Date().toISOString().slice(0, 10);

export function isValidEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const sourceInputSchema = z.object({
  title: z.string().trim().min(3).max(180),
  url: z.string().trim().max(2048).refine(isValidEvidenceUrl, "Source must be a public HTTPS URL."),
  access: z.enum(["public", "licensed"]),
  publishedAt: isoDate.optional(),
  note: z.string().trim().max(400).optional(),
}).strict();

const sourceReference = z.object({
  sourceId: z.string().trim().min(1).max(120).optional(),
  source: sourceInputSchema.optional(),
}).refine((value) => Boolean(value.sourceId) !== Boolean(value.source), "Provide exactly one sourceId or source.");

const bucketInput = z.object({
  label: z.string().trim().min(1).max(40),
  fiscalYear: z.number().int().min(2000).max(2200).nullable(),
  senior: nonNegativeAmount,
  junior: nonNegativeAmount,
  unclassified: nonNegativeAmount,
}).strict().refine(
  (bucket) => bucket.senior !== null || bucket.junior !== null || bucket.unclassified !== null,
  "Each bucket must report at least one amount; use null for an unknown split and zero for a reported zero.",
);

export const maturityInputSchema = z.object({
  ticker: z.string().trim().min(1).max(12),
  asOf: isoDate,
  currency: z.literal("USD"),
  scale: z.literal("millions"),
  basis: z.string().trim().min(5).max(240),
  reviewed: z.boolean(),
  buckets: z.array(bucketInput).min(1).max(30),
  note: z.string().trim().max(500).optional(),
  sourceId: sourceReference.shape.sourceId,
  source: sourceReference.shape.source,
}).strict().superRefine((value, ctx) => {
  if (value.asOf > today()) {
    ctx.addIssue({ code: "custom", message: "Maturity source date cannot be in the future.", path: ["asOf"] });
  }
  if (Boolean(value.sourceId) === Boolean(value.source)) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one sourceId or source.", path: ["source"] });
  }
  const seen = new Set<number | null>();
  let lastYear = 0;
  value.buckets.forEach((bucket, index) => {
    if (seen.has(bucket.fiscalYear)) {
      ctx.addIssue({ code: "custom", message: "Duplicate maturity year.", path: ["buckets", index, "fiscalYear"] });
    }
    seen.add(bucket.fiscalYear);
    if (bucket.fiscalYear === null) {
      if (index !== value.buckets.length - 1 || !/thereafter/i.test(bucket.label)) {
        ctx.addIssue({ code: "custom", message: "The final undated bucket must be labeled Thereafter.", path: ["buckets", index] });
      }
    } else if (bucket.fiscalYear <= lastYear || bucket.fiscalYear < Number(value.asOf.slice(0, 4))) {
      ctx.addIssue({ code: "custom", message: "Maturity years must be future-facing and ascending.", path: ["buckets", index, "fiscalYear"] });
    } else {
      lastYear = bucket.fiscalYear;
    }
  });
  const total = value.buckets.reduce((sum, bucket) => sum + (bucket.senior ?? 0) + (bucket.junior ?? 0) + (bucket.unclassified ?? 0), 0);
  if (total <= 0) ctx.addIssue({ code: "custom", message: "A maturity schedule needs a positive reported total.", path: ["buckets"] });
});

export const ratingInputSchema = z.object({
  ticker: z.string().trim().min(1).max(12),
  agency: z.enum(["Moody's", "S&P", "Fitch", "Other"]),
  rating: z.string().trim().regex(/^[A-Za-z0-9+/-]{1,16}$/, "Enter only the rating grade."),
  scope: z.string().trim().min(3).max(100),
  asOf: isoDate,
  reviewed: z.boolean(),
  note: z.string().trim().max(500).optional(),
  sourceId: sourceReference.shape.sourceId,
  source: sourceReference.shape.source,
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.sourceId) === Boolean(value.source)) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one sourceId or source.", path: ["source"] });
  }
  if (value.asOf > today()) {
    ctx.addIssue({ code: "custom", message: "Rating date cannot be in the future.", path: ["asOf"] });
  }
});

type SourceInput = z.infer<typeof sourceInputSchema>;

export function assertCompanyIdentity(memo: Memo, ticker: string): void {
  if (memo.company.ticker.trim().toUpperCase() !== ticker.trim().toUpperCase()) {
    throw new Error(`This evidence is for ${ticker}, but the memo is for ${memo.company.ticker}.`);
  }
}

export function attachEvidenceSource(
  memo: Memo,
  reference: { sourceId?: string; source?: SourceInput },
  kind: Source["kind"],
  provenance: NonNullable<Source["provenance"]>,
  reviewed: boolean,
  allowedExistingKinds?: ReadonlyArray<Source["kind"]>,
): string {
  if (reference.sourceId) {
    const existing = memo.sources.find((source) => source.id === reference.sourceId);
    if (!existing || !isValidEvidenceUrl(existing.url)) throw new Error("Unknown or invalid sourceId.");
    if (allowedExistingKinds && !allowedExistingKinds.includes(existing.kind)) {
      throw new Error(`Source ${reference.sourceId} is not an appropriate source for this evidence type.`);
    }
    return existing.id;
  }
  if (!reference.source) throw new Error("A traceable source is required.");
  const id = `${kind}-${randomUUID()}`;
  memo.sources.push({
    ...reference.source,
    id,
    kind,
    provenance,
    reviewed,
    ...(reviewed ? { reviewedAt: new Date().toISOString() } : {}),
  });
  return id;
}

export function applyMaturityImport(memo: Memo, raw: unknown): Memo {
  const input = maturityInputSchema.parse(raw);
  assertCompanyIdentity(memo, input.ticker);
  const sourceId = attachEvidenceSource(memo, input, "analyst-document", "analyst-supplied", input.reviewed, ["filing", "analyst-document"]);
  const schedule: DebtMaturitySchedule = {
    asOf: input.asOf,
    currency: input.currency,
    scale: input.scale,
    basis: input.basis,
    sourceId,
    reviewed: input.reviewed,
    buckets: input.buckets,
    ...(input.note ? { note: input.note } : {}),
  };
  memo.debtMaturities = schedule;
  memo.reviewStatus = "draft";
  return memo;
}

export function applyRatingImport(memo: Memo, raw: unknown): Memo {
  const input = ratingInputSchema.parse(raw);
  assertCompanyIdentity(memo, input.ticker);
  const sourceId = attachEvidenceSource(memo, input, "analyst-document", "analyst-supplied", input.reviewed, ["rating-agency", "analyst-document"]);
  const rating: CreditRating = {
    agency: input.agency,
    rating: input.rating,
    scope: input.scope,
    asOf: input.asOf,
    sourceId,
    reviewed: input.reviewed,
    ...(input.note ? { note: input.note } : {}),
  };
  memo.creditRatings = [
    ...(memo.creditRatings ?? []).filter((item) => !(item.agency === rating.agency && item.scope === rating.scope && item.asOf === rating.asOf)),
    rating,
  ];
  memo.reviewStatus = "draft";
  return memo;
}
