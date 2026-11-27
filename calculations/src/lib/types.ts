export type Source = {
  id: string;
  title: string;
  url: string;
  kind: "filing" | "public-news" | "company-release" | "earnings-transcript" | "industry" | "analyst-document" | "rating-agency" | "trends" | "company-website" | "funding" | "founder-profile";
  access: "public" | "licensed";
  /** How this source entered the memo; independent from whether it is public or licensed. */
  provenance?: "sec-filing" | "publisher" | "analyst-supplied" | "google-trends-export" | "team1";
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
