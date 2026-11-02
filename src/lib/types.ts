export type Source = {
  id: string;
  title: string;
  url: string;
  kind: "filing" | "public-news" | "company-release" | "industry" | "analyst-document" | "rating-agency" | "trends";
  access: "public" | "licensed";
  /** How this source entered the memo; independent from whether it is public or licensed. */
  provenance?: "sec-filing" | "publisher" | "analyst-supplied" | "google-trends-export";
  reviewed?: boolean;
  reviewedAt?: string;
  publishedAt?: string;
  note?: string;
};

export type FinancialFact = {
  id: string;
  concept: string;
  value: number;
  unit: string;
  start?: string;
  end: string;
  form: string;
  filed: string;
  accession: string;
  sourceId: string;
};

export type Metric = {
  id: string;
  label: string;
  period: string;
  value: number | null;
  unit: "USD" | "percent" | "multiple" | "days";
  formula: string;
  inputFactIds: string[];
  status: "reported" | "calculated" | "estimated" | "unavailable";
  unavailableReason?: string;
  note?: string;
};

export type TrendPoint = {
  period: string;
  end: string;
  revenue: number | null;
  ebitda: number | null;
  revenueYoY: number | null;
  ebitdaYoY: number | null;
  revenueFactIds: string[];
  ebitdaFactIds: string[];
  grossProfit?: number | null;
  grossMarginBase?: number | null;
  grossMargin?: number | null;
  grossProfitFactIds?: string[];
  grossMarginBaseFactIds?: string[];
};

export type DebtMaturityBucket = {
  label: string;
  /** Null is reserved for a reported "thereafter" bucket. */
  fiscalYear: number | null;
  /** Null means the split was not reported; a zero means a reported zero. */
  senior: number | null;
  junior: number | null;
  unclassified: number | null;
};

export type DebtMaturitySchedule = {
  asOf: string;
  currency: "USD";
  scale: "millions";
  /** E.g. scheduled principal payments; prevents comparing with carrying debt. */
  basis: string;
  sourceId: string;
  reviewed: boolean;
  buckets: DebtMaturityBucket[];
  note?: string;
};

export type CreditRating = {
  agency: "Moody's" | "S&P" | "Fitch" | "Other";
  rating: string;
  /** Issuer, long-term debt, senior unsecured, or another explicit rating scope. */
  scope: string;
  asOf: string;
  sourceId: string;
  reviewed: boolean;
  note?: string;
};

export type GoogleTrendsPoint = {
  date: string;
  /** Google's relative index, 0–100. Null means the export did not report a value. */
  interest: number | null;
  note?: string;
};

export type GoogleTrendsSeries = {
  query: string;
  geography: string;
  periodStart: string;
  periodEnd: string;
  retrievedAt: string;
  sourceId: string;
  reviewed: boolean;
  points: GoogleTrendsPoint[];
};

export type Insight = {
  id: string;
  kind: "performance" | "credit" | "growth" | "risk" | "context";
  text: string;
  evidenceIds: string[];
  reviewed: boolean;
};

export type IndustryContext = {
  reportCode: string;
  reportTitle: string;
  publicationDate?: string;
  summary: string;
  sourceId: string;
};

export type Memo = {
  id: string;
  company: { name: string; ticker: string; cik: string; description?: string };
  generatedAt: string;
  periodLabel: string;
  facts: FinancialFact[];
  metrics: Metric[];
  annualTrends: TrendPoint[];
  quarterlyTrends: TrendPoint[];
  insights: Insight[];
  sources: Source[];
  industry?: IndustryContext;
  debtMaturities?: DebtMaturitySchedule;
  creditRatings?: CreditRating[];
  googleTrends?: GoogleTrendsSeries;
  warnings: string[];
  generationMode: "openai" | "local-draft";
  reviewStatus: "draft" | "reviewed";
};

export type PublicSourceInput = {
  title: string;
  url: string;
  publishedAt?: string;
  note: string;
  kind: "public-news" | "company-release";
};
