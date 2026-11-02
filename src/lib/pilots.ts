import type { FinancialFact, Insight, Memo, Metric, Source, TrendPoint } from "./types";

const WMT_FILING = "https://www.sec.gov/Archives/edgar/data/104169/000010416926000055/wmt-20260131.htm";
const MSFT_FILING = "https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm";
const MSFT_RELEASE = "https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast";

function metric(id: string, label: string, period: string, value: number | null, unit: Metric["unit"], formula: string, ids: string[], status: Metric["status"], note?: string): Metric {
  return { id, label, period, value, unit, formula, inputFactIds: ids, status, note,
    ...(status === "unavailable" ? { unavailableReason: note ?? "Required input has not been verified." } : {}) };
}
function fact(id: string, concept: string, valueMillions: number, start: string | undefined, end: string, accession: string, sourceId: string): FinancialFact {
  return { id, concept, value: valueMillions * 1e6, unit: "USD", start, end, form: "10-K", filed: sourceId.includes("wmt") ? "2026-03-13" : "2026-07-29", accession, sourceId };
}
function trend(period: string, end: string, revenueMillions: number, ebitdaMillions: number | null, revenueYoY: number | null, ebitdaYoY: number | null, revenueFactIds: string[], ebitdaFactIds: string[]): TrendPoint {
  return { period, end, revenue: revenueMillions * 1e6, ebitda: ebitdaMillions === null ? null : ebitdaMillions * 1e6, revenueYoY, ebitdaYoY, revenueFactIds, ebitdaFactIds };
}

function addGrossTrend(points: TrendPoint[], grossProfit: number[], salesBase: number[], prefix: string, salesPrefix: string): TrendPoint[] {
  return points.map((point, index) => ({
    ...point,
    grossProfit: grossProfit[index] * 1e6,
    grossMarginBase: salesBase[index] * 1e6,
    grossMargin: grossProfit[index] / salesBase[index] * 100,
    grossProfitFactIds: [`${prefix}-g${24 + index}`],
    grossMarginBaseFactIds: [`${prefix}-${salesPrefix}${24 + index}`],
  }));
}

export function pilotMemo(ticker: "WMT" | "MSFT"): Memo {
  if (ticker === "WMT") {
    const sourceId = "sec:wmt-fy26-10k";
    const source: Source = { id: sourceId, title: "Walmart FY2026 Form 10-K", url: WMT_FILING, kind: "filing", access: "public", provenance: "sec-filing", reviewed: true, publishedAt: "2026-03-13" };
    const facts = [
      fact("wmt-r24", "Total revenues", 648125, "2023-02-01", "2024-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-r25", "Total revenues", 680985, "2024-02-01", "2025-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-r26", "Total revenues", 713163, "2025-02-01", "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-s24", "Net sales", 642637, "2023-02-01", "2024-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-s25", "Net sales", 674538, "2024-02-01", "2025-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-s26", "Net sales", 706413, "2025-02-01", "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-cost24", "Cost of sales", 490142, "2023-02-01", "2024-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-cost25", "Cost of sales", 511753, "2024-02-01", "2025-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-cost26", "Cost of sales", 535395, "2025-02-01", "2026-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-g24", "Gross profit", 152495, "2023-02-01", "2024-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-g25", "Gross profit", 162785, "2024-02-01", "2025-01-31", "0000104169-26-000055", sourceId),
      fact("wmt-g26", "Gross profit", 171018, "2025-02-01", "2026-01-31", "0000104169-26-000055", sourceId),
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
    const annualTrends = addGrossTrend([
      trend("FY 2024", "2024-01-31", 648125, 38865, null, null, ["wmt-r24"], ["wmt-o24", "wmt-d24"]),
      trend("FY 2025", "2025-01-31", 680985, 42321, (680985 / 648125 - 1) * 100, (42321 / 38865 - 1) * 100, ["wmt-r25"], ["wmt-o25", "wmt-d25"]),
      trend("FY 2026", "2026-01-31", 713163, 44028, (713163 / 680985 - 1) * 100, (44028 / 42321 - 1) * 100, ["wmt-r26"], ["wmt-o26", "wmt-d26"]),
    ], [152495, 162785, 171018], [642637, 674538, 706413], "wmt", "s");
    const debtIds = ["wmt-short", "wmt-current", "wmt-long"];
    const metrics = [
      metric("revenue", "Revenue", "FY 2026", 713163e6, "USD", "Reported total revenues", ["wmt-r26"], "reported"),
      metric("revenue-growth", "Revenue growth", "FY 2026", annualTrends[2].revenueYoY, "percent", "FY2026 revenue / FY2025 revenue − 1", ["wmt-r26", "wmt-r25"], "calculated"),
      metric("gross-profit", "Gross profit", "FY 2026", 171018e6, "USD", "Net sales − cost of sales; reconciles to reported gross profit", ["wmt-s26", "wmt-cost26", "wmt-g26"], "reported"),
      metric("gross-margin", "Gross margin", "FY 2026", 171018 / 706413 * 100, "percent", "Gross profit / net sales", ["wmt-g26", "wmt-s26"], "calculated", "Uses net sales, not total revenues, as the filing's gross-profit base."),
      metric("ebitda", "Estimated EBITDA", "FY 2026", 44028e6, "USD", "Operating income + depreciation and amortization", ["wmt-o26", "wmt-d26"], "estimated", "Not covenant-defined EBITDA."),
      metric("ebitda-margin", "Estimated EBITDA margin", "FY 2026", 44028 / 713163 * 100, "percent", "Estimated EBITDA / revenue", ["wmt-o26", "wmt-d26", "wmt-r26"], "estimated"),
      metric("cash", "Cash and equivalents", "2026-01-31", 10727e6, "USD", "Reported cash and cash equivalents", ["wmt-cash"], "reported"),
      metric("debt", "Interest-bearing debt", "2026-01-31", 44762e6, "USD", "Short-term borrowings + current and noncurrent long-term debt", debtIds, "calculated", "Excludes lease obligations."),
      metric("leverage", "Gross leverage estimate", "2026-01-31", 44762 / 44028, "multiple", "Interest-bearing debt / FY2026 estimated EBITDA", [...debtIds, "wmt-o26", "wmt-d26"], "estimated", "Not a covenant-defined ratio."),
      metric("fccr", "Fixed charge coverage", "Definition pending", null, "multiple", "Pending client-approved formula", [], "unavailable", "Ashley has not approved the formula and required inputs."),
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
      debtMaturities: {
        asOf: "2026-01-31", currency: "USD", scale: "millions", basis: "Reported annual maturities of long-term debt", sourceId, reviewed: true,
        note: "The $38.166B maturity schedule excludes $6.596B of short-term borrowings in the broader debt metric. The filing does not allocate each maturity between senior and junior debt.",
        buckets: [
          { label: "FY27", fiscalYear: 2027, senior: null, junior: null, unclassified: 3542 },
          { label: "FY28", fiscalYear: 2028, senior: null, junior: null, unclassified: 3237 },
          { label: "FY29", fiscalYear: 2029, senior: null, junior: null, unclassified: 3389 },
          { label: "FY30", fiscalYear: 2030, senior: null, junior: null, unclassified: 2143 },
          { label: "FY31", fiscalYear: 2031, senior: null, junior: null, unclassified: 2600 },
          { label: "Thereafter", fiscalYear: null, senior: null, junior: null, unclassified: 23255 },
        ],
      },
      warnings: ["Design reference from Walmart's FY2026 10-K. It does not include later quarterly filings."],
      generationMode: "local-draft", reviewStatus: "draft",
    };
  }
  const filingId = "sec:msft-fy26-10k";
  const releaseId = "public:msft-fy26-release";
  const sources: Source[] = [
    { id: filingId, title: "Microsoft FY2026 Form 10-K", url: MSFT_FILING, kind: "filing", access: "public", provenance: "sec-filing", reviewed: true, publishedAt: "2026-07-29" },
    { id: releaseId, title: "Microsoft FY2026 Q4 earnings release", url: MSFT_RELEASE, kind: "company-release", access: "public", provenance: "publisher", reviewed: true, publishedAt: "2026-07-29" },
  ];
  const facts = [
    fact("msft-r24", "Total revenue", 245122, "2023-07-01", "2024-06-30", "0001193125-26-323660", filingId),
    fact("msft-r25", "Total revenue", 281724, "2024-07-01", "2025-06-30", "0001193125-26-323660", filingId),
    fact("msft-r26", "Total revenue", 331839, "2025-07-01", "2026-06-30", "0001193125-26-323660", filingId),
    fact("msft-cost24", "Total cost of revenue", 74114, "2023-07-01", "2024-06-30", "0001193125-26-323660", filingId),
    fact("msft-cost25", "Total cost of revenue", 87831, "2024-07-01", "2025-06-30", "0001193125-26-323660", filingId),
    fact("msft-cost26", "Total cost of revenue", 106374, "2025-07-01", "2026-06-30", "0001193125-26-323660", filingId),
    fact("msft-g24", "Gross profit (gross margin in filing)", 171008, "2023-07-01", "2024-06-30", "0001193125-26-323660", filingId),
    fact("msft-g25", "Gross profit (gross margin in filing)", 193893, "2024-07-01", "2025-06-30", "0001193125-26-323660", filingId),
    fact("msft-g26", "Gross profit (gross margin in filing)", 225465, "2025-07-01", "2026-06-30", "0001193125-26-323660", filingId),
    fact("msft-cash", "Cash and cash equivalents", 20935, undefined, "2026-06-30", "0001193125-26-323660", filingId),
    fact("msft-current", "Current portion of long-term debt", 9227, undefined, "2026-06-30", "0001193125-26-323660", filingId),
    fact("msft-long", "Long-term debt", 31067, undefined, "2026-06-30", "0001193125-26-323660", filingId),
  ];
  const annualTrends = addGrossTrend([
    trend("FY 2024", "2024-06-30", 245122, null, null, null, ["msft-r24"], []),
    trend("FY 2025", "2025-06-30", 281724, null, (281724 / 245122 - 1) * 100, null, ["msft-r25"], []),
    trend("FY 2026", "2026-06-30", 331839, null, (331839 / 281724 - 1) * 100, null, ["msft-r26"], []),
  ], [171008, 193893, 225465], [245122, 281724, 331839], "msft", "r");
  const metrics = [
    metric("revenue", "Revenue", "FY 2026", 331839e6, "USD", "Reported total revenue", ["msft-r26"], "reported"),
    metric("revenue-growth", "Revenue growth", "FY 2026", annualTrends[2].revenueYoY, "percent", "FY2026 revenue / FY2025 revenue − 1", ["msft-r26", "msft-r25"], "calculated"),
    metric("gross-profit", "Gross profit", "FY 2026", 225465e6, "USD", "Reported gross profit (gross margin dollar line)", ["msft-g26"], "reported"),
    metric("gross-margin", "Gross margin", "FY 2026", 225465 / 331839 * 100, "percent", "Gross profit / total revenue", ["msft-g26", "msft-r26"], "calculated"),
    metric("ebitda", "Estimated EBITDA", "FY 2026", null, "USD", "Operating income + separately verified D&A", [], "unavailable", "The filing's combined depreciation, amortization and other line is not treated as pure D&A."),
    metric("ebitda-margin", "Estimated EBITDA margin", "FY 2026", null, "percent", "Estimated EBITDA / revenue", [], "unavailable", "Estimated EBITDA is unavailable without a separately verified D&A input."),
    metric("cash", "Cash and equivalents", "2026-06-30", 20935e6, "USD", "Reported cash and cash equivalents", ["msft-cash"], "reported"),
    metric("debt", "Long-term debt subtotal", "2026-06-30", 40294e6, "USD", "Current portion of long-term debt + noncurrent long-term debt", ["msft-current", "msft-long"], "calculated", "Excludes lease obligations; no separate short-term borrowings line is shown."),
    metric("leverage", "Gross leverage estimate", "2026-06-30", null, "multiple", "Debt / estimated EBITDA", [], "unavailable", "Estimated EBITDA is unavailable; leverage is not inferred."),
    metric("fccr", "Fixed charge coverage", "Definition pending", null, "multiple", "Pending client-approved formula", [], "unavailable", "Ashley has not approved the formula and required inputs."),
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
    debtMaturities: {
      asOf: "2026-06-30", currency: "USD", scale: "millions", basis: "Face value maturities of senior unsecured long-term debt", sourceId: filingId, reviewed: true,
      note: "The $46.136B maturity schedule is face value. After $1.081B unamortized discount and issuance costs, $0.011B hedge adjustments, and $4.750B debt-exchange premium, carrying debt is $40.294B.",
      buckets: [
        { label: "FY27", fiscalYear: 2027, senior: 9250, junior: 0, unclassified: 0 },
        { label: "FY28", fiscalYear: 2028, senior: 0, junior: 0, unclassified: 0 },
        { label: "FY29", fiscalYear: 2029, senior: 2001, junior: 0, unclassified: 0 },
        { label: "FY30", fiscalYear: 2030, senior: 0, junior: 0, unclassified: 0 },
        { label: "FY31", fiscalYear: 2031, senior: 500, junior: 0, unclassified: 0 },
        { label: "Thereafter", fiscalYear: null, senior: 34385, junior: 0, unclassified: 0 },
      ],
    },
    warnings: ["Design reference from Microsoft's FY2026 10-K and earnings release. Not a live filing refresh."],
    generationMode: "local-draft", reviewStatus: "draft",
  };
}
