export type Source = {
  id: string;
  title: string;
  url: string;
  kind: "filing" | "public-news" | "company-release" | "industry";
  access: "public" | "licensed";
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
  unit: "USD" | "percent" | "multiple";
  formula: string;
  inputFactIds: string[];
  status: "reported" | "calculated" | "estimated" | "unavailable";
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
