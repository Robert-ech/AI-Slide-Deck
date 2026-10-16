import type { FinancialFact, Insight, Memo, Metric, Source, TrendPoint } from "./types";

const WMT_FILING = "https://www.sec.gov/Archives/edgar/data/104169/000010416926000055/wmt-20260131.htm";
const MSFT_FILING = "https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm";
const MSFT_RELEASE = "https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast";

function metric(id: string, label: string, period: string, value: number | null, unit: Metric["unit"], formula: string, ids: string[], status: Metric["status"], note?: string): Metric {
  return { id, label, period, value, unit, formula, inputFactIds: ids, status, note };
}
function fact(id: string, concept: string, valueMillions: number, start: string | undefined, end: string, accession: string, sourceId: string): FinancialFact {
  return { id, concept, value: valueMillions * 1e6, unit: "USD", start, end, form: "10-K", filed: sourceId.includes("wmt") ? "2026-03-13" : "2026-07-29", accession, sourceId };
}
function trend(period: string, end: string, revenueMillions: number, ebitdaMillions: number | null, revenueYoY: number | null, ebitdaYoY: number | null, revenueFactIds: string[], ebitdaFactIds: string[]): TrendPoint {
  return { period, end, revenue: revenueMillions * 1e6, ebitda: ebitdaMillions === null ? null : ebitdaMillions * 1e6, revenueYoY, ebitdaYoY, revenueFactIds, ebitdaFactIds };
}

export function pilotMemo(ticker: "WMT" | "MSFT"): Memo {
  if (ticker === "WMT") {
    const sourceId = "sec:wmt-fy26-10k";
    const source: Source = { id: sourceId, title: "Walmart FY2026 Form 10-K", url: WMT_FILING, kind: "filing", access: "public", publishedAt: "2026-03-13" };
    const facts = [
      fact("wmt-r24", "Total revenues", 648125, "2023-02-01", "2024-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-r25", "Total revenues", 680985, "2024-02-01", "2025-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-r26", "Total revenues", 713163, "2025-02-01", "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-o24", "Operating income", 27012, "2023-02-01", "2024-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-o25", "Operating income", 29348, "2024-02-01", "2025-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-o26", "Operating income", 29825, "2025-02-01", "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-d24", "Depreciation and amortization", 11853, "2023-02-01", "2024-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-d25", "Depreciation and amortization", 12973, "2024-02-01", "2025-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-d26", "Depreciation and amortization", 14203, "2025-02-01", "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-cash", "Cash and cash equivalents", 10727, undefined, "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-short", "Short-term borrowings", 6596, undefined, "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-current", "Long-term debt due within one year", 3542, undefined, "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-long", "Long-term debt", 34624, undefined, "2026-01-31", "0000104169-26-000055", sourceId),
    ];
    const annualTrends = [
      trend("FY 2024", "2024-01-31", 648125, 38865, null, null, ["wmt-r24"], ["wmt-o24", "wmt-d24"]),
      trend("FY 2025", "2025-01-31", 680985, 42321, (680985 / 648125 - 1) * 100, (42321 / 38865 - 1) * 100, ["wmt-r25"], ["wmt-o25", "wmt-d25"]),
      trend("FY 2026", "2026-01-31", 713163, 44028, (713163 / 680985 - 1) * 100, (44028 / 42321 - 1) * 100, ["wmt-r26"], ["wmt-o26", "wmt-d26"]),
    ];
    const debtIds = ["wmt-short", "wmt-current", "wmt-long"];
    const metrics = [
      metric("revenue", "Revenue", "FY 2026", 713163e6, "USD", "Reported total revenues", ["wmt-r26"], "reported"),
      metric("revenue-growth", "Revenue growth", "FY 2026", annualTrends[2].revenueYoY, "percent", "FY2026 revenue / FY2025 revenue − 1", ["wmt-r26", "wmt-r25"], "calculated"),
      metric("ebitda", "Estimated EBITDA", "FY 2026", 44028e6, "USD", "Operating income + depreciation and amortization", ["wmt-o26", "wmt-d26"], "estimated", "Not covenant-defined EBITDA."),
      metric("ebitda-margin", "Estimated EBITDA margin", "FY 2026", 44028 / 713163 * 100, "percent", "Estimated EBITDA / revenue", ["wmt-o26", "wmt-d26", "wmt-r26"], "estimated"),
      metric("cash", "Cash and equivalents", "2026-01-31", 10727e6, "USD", "Reported cash and cash equivalents", ["wmt-cash"], "reported"),
      metric("debt", "Interest-bearing debt", "2026-01-31", 44762e6, "USD", "Short-term borrowings + current and noncurrent long-term debt", debtIds, "calculated", "Excludes lease obligations."),
      metric("leverage", "Gross leverage estimate", "2026-01-31", 44762 / 44028, "multiple", "Interest-bearing debt / FY2026 estimated EBITDA", [...debtIds, "wmt-o26", "wmt-d26"], "estimated", "Not a covenant-defined ratio."),
      metric("fccr", "Fixed charge coverage", "Definition pending", null, "multiple", "Pending client-approved formula", [], "unavailable"),
    ];
    const insights: Insight[] = [
      { id: "wmt-i1", kind: "performance", text: "FY2026 revenue rose 4.7% to $713.2B. Walmart attributes the increase mainly to positive comparable sales across U.S. segments and international markets.", evidenceIds: [sourceId], reviewed: false },
      { id: "wmt-i2", kind: "growth", text: "Walmart U.S. eCommerce sales reached about $99.6B, up from $79.3B. Store-fulfilled pickup and delivery supported comparable-sales growth.", evidenceIds: [sourceId], reviewed: false },
      { id: "wmt-i3", kind: "credit", text: "Interest-bearing debt shown here totals $44.8B before lease obligations. The resulting 1.02× EBITDA ratio is a screening estimate, not a covenant measure.", evidenceIds: [sourceId], reviewed: false },
      { id: "wmt-i4", kind: "risk", text: "Walmart reported $10.7B of cash, but about $3.9B may not be freely transferable to the U.S.; gross cash therefore overstates immediately fungible domestic liquidity.", evidenceIds: [sourceId], reviewed: false },
    ];
    return {
      id: "pilot-wmt-fy26", company: { name: "Walmart Inc.", ticker, cik: "0000104169", description: "Retail / omnichannel" },
      generatedAt: "2026-10-16T12:00:00.000Z", periodLabel: "FY 2026 manual pilot",
      facts, metrics, annualTrends, quarterlyTrends: [], insights, sources: [source],
      warnings: ["Design reference from Walmart's FY2026 10-K. It does not include later quarterly filings."],
      generationMode: "local-draft", reviewStatus: "draft",
    };
  }
  const filingId = "sec:msft-fy26-10k";
  const releaseId = "public:msft-fy26-release";
  const sources: Source[] = [
    { id: filingId, title: "Microsoft FY2026 Form 10-K", url: MSFT_FILING, kind: "filing", access: "public", publishedAt: "2026-07-29" },
    { id: releaseId, title: "Microsoft FY2026 Q4 earnings release", url: MSFT_RELEASE, kind: "company-release", access: "public", publishedAt: "2026-07-29" },
  ];
  const facts = [
    fact("msft-r24", "Total revenue", 245122, "2023-07-01", "2024-06-30", "0001193125-26-323660", filingId),
    fact("msft-r25", "Total revenue", 281724, "2024-07-01", "2025-06-30", "0001193125-26-323660", filingId),
    fact("msft-r26", "Total revenue", 331839, "2025-07-01", "2026-06-30", "0001193125-26-323660", filingId),
    fact("msft-cash", "Cash and cash equivalents", 20935, undefined, "2026-06-30", "0001193125-26-323660", filingId),
    fact("msft-current", "Current portion of long-term debt", 9227, undefined, "2026-06-30", "0001193125-26-323660", filingId),
    fact("msft-long", "Long-term debt", 31067, undefined, "2026-06-30", "0001193125-26-323660", filingId),
  ];
  const annualTrends = [
    trend("FY 2024", "2024-06-30", 245122, null, null, null, ["msft-r24"], []),
    trend("FY 2025", "2025-06-30", 281724, null, (281724 / 245122 - 1) * 100, null, ["msft-r25"], []),
    trend("FY 2026", "2026-06-30", 331839, null, (331839 / 281724 - 1) * 100, null, ["msft-r26"], []),
  ];
  const metrics = [
    metric("revenue", "Revenue", "FY 2026", 331839e6, "USD", "Reported total revenue", ["msft-r26"], "reported"),
    metric("revenue-growth", "Revenue growth", "FY 2026", annualTrends[2].revenueYoY, "percent", "FY2026 revenue / FY2025 revenue − 1", ["msft-r26", "msft-r25"], "calculated"),
    metric("ebitda", "Estimated EBITDA", "FY 2026", null, "USD", "Operating income + separately verified D&A", [], "unavailable", "The filing's combined depreciation, amortization and other line is not treated as pure D&A."),
    metric("ebitda-margin", "Estimated EBITDA margin", "FY 2026", null, "percent", "Estimated EBITDA / revenue", [], "unavailable"),
    metric("cash", "Cash and equivalents", "2026-06-30", 20935e6, "USD", "Reported cash and cash equivalents", ["msft-cash"], "reported"),
    metric("debt", "Long-term debt subtotal", "2026-06-30", 40294e6, "USD", "Current portion of long-term debt + noncurrent long-term debt", ["msft-current", "msft-long"], "calculated", "Excludes lease obligations; no separate short-term borrowings line is shown."),
    metric("leverage", "Gross leverage estimate", "2026-06-30", null, "multiple", "Debt / estimated EBITDA", [], "unavailable"),
    metric("fccr", "Fixed charge coverage", "Definition pending", null, "multiple", "Pending client-approved formula", [], "unavailable"),
  ];
  const insights: Insight[] = [
    { id: "msft-i1", kind: "performance", text: "FY2026 revenue increased 17.8% to $331.8B. Microsoft said cloud and AI demand supported the year's growth.", evidenceIds: [filingId, releaseId], reviewed: false },
    { id: "msft-i2", kind: "growth", text: "The earnings release reported Azure annual revenue above $100B, making cloud demand a material item for follow-up research.", evidenceIds: [releaseId], reviewed: false },
    { id: "msft-i3", kind: "credit", text: "Cash and equivalents were $20.9B at June 30, 2026; the filing also reports $55.9B of short-term investments. Availability and restrictions still require review.", evidenceIds: [filingId], reviewed: false },
    { id: "msft-i4", kind: "risk", text: "Long-term debt including the current portion was $40.3B. EBITDA and leverage remain unavailable because a separately verified depreciation and amortization input has not been established.", evidenceIds: [filingId], reviewed: false },
  ];
  return {
    id: "pilot-msft-fy26", company: { name: "Microsoft Corporation", ticker, cik: "0000789019", description: "Software / cloud services" },
    generatedAt: "2026-10-16T12:00:00.000Z", periodLabel: "FY 2026 manual pilot",
    facts, metrics, annualTrends, quarterlyTrends: [], insights, sources,
    warnings: ["Design reference from Microsoft's FY2026 10-K and earnings release. Not a live filing refresh."],
    generationMode: "local-draft", reviewStatus: "draft",
  };
}
