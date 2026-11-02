import { filingUrl, type CompanyFacts, type Submissions, type XbrlEntry } from "./sec";
import type { FinancialFact, Metric, Source, TrendPoint } from "./types";

type Selected = { concept: string; entry: XbrlEntry; inputs?: Selected[] };
type Series = { start?: string; end: string; value: number; selections: Selected[] };

const CONCEPTS = {
  // Prefer the reported top line when an issuer separately presents net sales and other income.
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"],
  grossProfit: ["GrossProfit"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  operatingIncome: ["OperatingIncomeLoss"],
  depreciation: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
    "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment",
  ],
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  inventory: ["InventoryNet"],
  receivables: ["AccountsReceivableNetCurrent", "AccountsReceivableNet"],
  debtShortTerm: ["ShortTermBorrowings", "ShortTermDebt", "ShortTermBorrowingsCurrent"],
  debtCurrent: ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  debtNoncurrent: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligationsNoncurrent"],
} as const;

function days(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
}

function nextDay(date: string): string {
  return new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10);
}

function entries(facts: CompanyFacts, concept: string): XbrlEntry[] {
  return facts.facts["us-gaap"]?.[concept]?.units?.USD ?? [];
}

function selectConcept(facts: CompanyFacts, candidates: readonly string[]): string | null {
  const scored = candidates.map((concept, priority) => {
    const annual = entries(facts, concept).filter(
      (entry) => entry.start && entry.fp === "FY" && entry.form.startsWith("10-K") && days(entry.start, entry.end) >= 330,
    );
    return { concept, priority, count: new Set(annual.map((entry) => entry.end)).size, latest: annual.map((entry) => entry.end).sort().at(-1) ?? "" };
  });
  scored.sort((a, b) => b.latest.localeCompare(a.latest) || b.count - a.count || a.priority - b.priority);
  return scored[0]?.latest ? scored[0].concept : null;
}

function latestByEnd(concept: string, values: XbrlEntry[]): Series[] {
  const byEnd = new Map<string, XbrlEntry>();
  for (const entry of values) {
    const previous = byEnd.get(entry.end);
    if (!previous || entry.filed > previous.filed) byEnd.set(entry.end, entry);
  }
  return [...byEnd.values()]
    .sort((a, b) => a.end.localeCompare(b.end))
    .map((entry) => ({ start: entry.start, end: entry.end, value: entry.val, selections: [{ concept, entry }] }));
}

function annual(facts: CompanyFacts, concept: string | null): Series[] {
  if (!concept) return [];
  return latestByEnd(
    concept,
    entries(facts, concept).filter(
      (entry) =>
        entry.start &&
        entry.form.startsWith("10-K") &&
        entry.fp === "FY" &&
        days(entry.start, entry.end) >= 330 &&
        days(entry.start, entry.end) <= 400,
    ),
  ).slice(-4);
}

function quarterly(facts: CompanyFacts, concept: string | null): Series[] {
  if (!concept) return [];
  const values = entries(facts, concept).filter((entry) => entry.start && /^10-[QK]/.test(entry.form));
  const direct = latestByEnd(
    concept,
    values.filter((entry) => days(entry.start!, entry.end) >= 70 && days(entry.start!, entry.end) <= 110),
  );
  const byEnd = new Map(direct.map((point) => [point.end, point]));

  // XBRL often reports year-to-date Q2/Q3 cash-flow concepts and no standalone Q4.
  const cumulative = latestByEnd(
    concept,
    values.filter((entry) => days(entry.start!, entry.end) >= 155 && days(entry.start!, entry.end) <= 305),
  );
  for (const current of cumulative) {
    if (byEnd.has(current.end)) continue;
    const currentEntry = current.selections[0].entry;
    const previous = values
      .filter((entry) => entry.start === currentEntry.start && entry.end < current.end && days(entry.end, current.end) <= 115)
      .sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
    if (previous) {
      byEnd.set(current.end, {
        start: nextDay(previous.end),
        end: current.end,
        value: current.value - previous.val,
        selections: [current.selections[0], { concept, entry: previous }],
      });
    }
  }
  const annualEntries = annual(facts, concept);
  for (const year of annualEntries) {
    if (byEnd.has(year.end)) continue;
    const yearEntry = year.selections[0].entry;
    const nineMonths = values
      .filter(
        (entry) =>
          entry.start === yearEntry.start &&
          entry.end < year.end &&
          days(entry.start!, entry.end) >= 245 &&
          days(entry.start!, entry.end) <= 305 &&
          days(entry.end, year.end) <= 115,
      )
      .sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
    if (nineMonths) {
      byEnd.set(year.end, {
        start: nextDay(nineMonths.end),
        end: year.end,
        value: year.value - nineMonths.val,
        selections: [year.selections[0], { concept, entry: nineMonths }],
      });
    }
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end)).slice(-12);
}

function instantSeries(facts: CompanyFacts, candidates: readonly string[]): Series[] {
  const all: Series[] = [];
  for (const concept of candidates) {
    all.push(...latestByEnd(
      concept,
      entries(facts, concept).filter((entry) => !entry.start && /^10-[QK]/.test(entry.form)),
    ));
  }
  const byEnd = new Map<string, Series>();
  for (const point of all) {
    if (!byEnd.has(point.end)) byEnd.set(point.end, point);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

function pointForEnd(series: Series[], end: string): Series | undefined {
  return series.find((point) => point.end === end);
}

function pointForPeriod(series: Series[], period: Series): Series | undefined {
  return series.find((point) => point.start === period.start && point.end === period.end);
}

function sameFiling(a: Series, b: Series): boolean {
  return a.selections[0].entry.accn === b.selections[0].entry.accn;
}

function reportedEbitda(facts: CompanyFacts): Series[] {
  const candidates: Series[] = [];
  for (const [namespace, concepts] of Object.entries(facts.facts)) {
    for (const concept of ["EarningsBeforeInterestTaxesDepreciationAndAmortization", "EBITDA"]) {
      const fact = concepts[concept];
      if (!fact || !/^(EBITDA|earnings before interest.*tax.*depreciation.*amortization)$/i.test(fact.label.trim())) continue;
      const values = fact.units.USD?.filter((entry) => entry.start && entry.fp === "FY" && entry.form.startsWith("10-K") &&
        days(entry.start, entry.end) >= 330 && days(entry.start, entry.end) <= 400) ?? [];
      candidates.push(...latestByEnd(`${namespace}:${concept}`, values));
    }
  }
  return candidates;
}

function valueYoY(series: Series[], index: number, quarterlyMode: boolean): number | null {
  const current = series[index];
  const previous = quarterlyMode
    ? series.find((point) => point.end < current.end && point.start && current.start &&
      Math.abs(days(point.end, current.end) - 365) <= 30 && Math.abs(days(point.start, current.start) - 365) <= 30)
    : series[index - 1];
  if (!previous || previous.value === 0) return null;
  if (!quarterlyMode && (Math.abs(days(previous.end, current.end) - 365) > 45 ||
    !previous.start || !current.start || Math.abs(days(previous.start, current.start) - 365) > 45)) return null;
  return ((current.value / previous.value) - 1) * 100;
}

export function buildFinancials(cik: string, facts: CompanyFacts, submissions: Submissions): {
  facts: FinancialFact[];
  metrics: Metric[];
  annualTrends: TrendPoint[];
  quarterlyTrends: TrendPoint[];
  sources: Source[];
  periodLabel: string;
  warnings: string[];
} {
  const revenueConcept = selectConcept(facts, CONCEPTS.revenue);
  const operatingConcept = selectConcept(facts, CONCEPTS.operatingIncome);
  const depreciationConcept = selectConcept(facts, CONCEPTS.depreciation);
  const revenueAnnual = annual(facts, revenueConcept);
  const operatingAnnual = annual(facts, operatingConcept);
  const depreciationAnnual = annual(facts, depreciationConcept);
  const reportedEbitdaAnnual = reportedEbitda(facts);
  function reportedEbitdaForPeriod(period: Series): Series | undefined {
    const matches = reportedEbitdaAnnual.filter((point) => point.start === period.start && point.end === period.end);
    if (new Set(matches.map((point) => point.value)).size !== 1) return undefined;
    return matches.sort((a, b) => b.selections[0].entry.filed.localeCompare(a.selections[0].entry.filed))[0];
  }
  const grossProfitAnnual = annual(facts, CONCEPTS.grossProfit[0]);
  const grossRevenueAnnual = new Map<string, Series[]>(CONCEPTS.revenue.map((concept) => [concept, annual(facts, concept)]));
  const grossCostAnnual = new Map<string, Series[]>(CONCEPTS.costOfRevenue.map((concept) => [concept, annual(facts, concept)]));
  const revenueQuarterly = quarterly(facts, revenueConcept);
  const operatingQuarterly = quarterly(facts, operatingConcept);
  const depreciationQuarterly = quarterly(facts, depreciationConcept);
  const cash = instantSeries(facts, CONCEPTS.cash).at(-1) ?? null;
  const inventory = instantSeries(facts, CONCEPTS.inventory).filter((point) => point.selections[0].entry.form.startsWith("10-K"));
  const receivables = instantSeries(facts, CONCEPTS.receivables).filter((point) => point.selections[0].entry.form.startsWith("10-K"));
  const shortDebtSeries = instantSeries(facts, CONCEPTS.debtShortTerm);
  const currentDebtSeries = instantSeries(facts, CONCEPTS.debtCurrent);
  const noncurrentDebtSeries = instantSeries(facts, CONCEPTS.debtNoncurrent);
  const factMap = new Map<string, FinancialFact>();
  const sourceMap = new Map<string, Source>();
  const warnings: string[] = [];

  function register(selections: Selected[]): string[] {
    return selections.map(({ concept, entry }) => {
      const id = `${concept}:${entry.start ?? "instant"}:${entry.end}:${entry.accn}`;
      const sourceId = `sec:${entry.accn}`;
      if (!sourceMap.has(sourceId)) {
        sourceMap.set(sourceId, {
          id: sourceId,
          title: `${entry.form} filed ${entry.filed}`,
          url: filingUrl(cik, entry.accn, submissions),
          kind: "filing",
          access: "public",
          publishedAt: entry.filed,
        });
      }
      if (!factMap.has(id)) {
        factMap.set(id, {
          id,
          concept,
          value: entry.val,
          unit: "USD",
          start: entry.start,
          end: entry.end,
          form: entry.form,
          filed: entry.filed,
          accession: entry.accn,
          sourceId,
        });
      }
      return id;
    });
  }

  function grossForPeriod(period: Series): {
    profit: number; base: number; cost?: number;
    profitSelections: Selected[]; baseSelections: Selected[]; costSelections?: Selected[];
  } | null {
    const reported = pointForPeriod(grossProfitAnnual, period);
    const revenueOrder = (cost: string): readonly string[] => cost === "CostOfRevenue"
      ? CONCEPTS.revenue
      : ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"];

    for (const costConcept of CONCEPTS.costOfRevenue) {
      const cost = pointForPeriod(grossCostAnnual.get(costConcept) ?? [], period);
      if (!cost) continue;
      for (const revenueConcept of revenueOrder(costConcept)) {
        const base = pointForPeriod(grossRevenueAnnual.get(revenueConcept) ?? [], period);
        if (!base || base.value <= 0 || !sameFiling(base, cost)) continue;
        const derivedProfit = base.value - cost.value;
        if (derivedProfit < 0) continue;
        if (reported) {
          // A directly tagged gross-profit line identifies the compatible sales base.
          // Reject a seemingly plausible combination when it does not reconcile.
          if (!sameFiling(reported, base) || reported.value < 0 || reported.value > base.value ||
            Math.abs(derivedProfit - reported.value) > Math.max(1, base.value * 0.000003)) continue;
          return { profit: reported.value, base: base.value, cost: cost.value,
            profitSelections: reported.selections, baseSelections: base.selections, costSelections: cost.selections };
        }
        return {
          profit: derivedProfit,
          base: base.value,
          cost: cost.value,
          profitSelections: [...base.selections, ...cost.selections],
          baseSelections: base.selections,
          costSelections: cost.selections,
        };
      }
    }

    // A reported gross-profit fact can be used alone only if its denominator is unambiguous.
    if (reported) {
      const candidates = CONCEPTS.revenue
        .map((concept) => pointForPeriod(grossRevenueAnnual.get(concept) ?? [], period))
        .filter((candidate): candidate is Series => Boolean(candidate && candidate.value > 0 && sameFiling(candidate, reported)));
      if (candidates.length === 1 && reported.value >= 0 && reported.value <= candidates[0].value) {
        return {
          profit: reported.value, base: candidates[0].value,
          profitSelections: reported.selections, baseSelections: candidates[0].selections,
        };
      }
    }
    return null;
  }

  function trend(revenues: Series[], operations: Series[], depreciations: Series[], isQuarterly: boolean): TrendPoint[] {
    return revenues.map((revenue, index) => {
      const operation = pointForPeriod(operations, revenue);
      const depreciation = pointForPeriod(depreciations, revenue);
      const gross = isQuarterly ? null : grossForPeriod(revenue);
      const reported = isQuarterly ? undefined : reportedEbitdaForPeriod(revenue);
      const ebitda = reported?.value ?? (operation && depreciation ? operation.value + depreciation.value : null);
      const previous = isQuarterly
        ? revenues.find((point) => point.end < revenue.end && point.start && revenue.start &&
          Math.abs(days(point.end, revenue.end) - 365) <= 30 && Math.abs(days(point.start, revenue.start) - 365) <= 30)
        : revenues[index - 1];
      const previousOperation = previous && pointForPeriod(operations, previous);
      const previousDepreciation = previous && pointForPeriod(depreciations, previous);
      const previousReported = !isQuarterly && previous ? reportedEbitdaForPeriod(previous) : undefined;
      const previousEbitda = previousReported?.value ??
        (previousOperation && previousDepreciation ? previousOperation.value + previousDepreciation.value : null);
      return {
        period: isQuarterly ? `Q ${revenue.end}` : `FY ${revenue.end.slice(0, 4)}`,
        end: revenue.end,
        revenue: revenue.value,
        ebitda,
        revenueYoY: valueYoY(revenues, index, isQuarterly),
        ebitdaYoY: ebitda !== null && previousEbitda ? ((ebitda / previousEbitda) - 1) * 100 : null,
        revenueFactIds: register(revenue.selections),
        ebitdaFactIds: reported ? register(reported.selections) : operation && depreciation
          ? register([...operation.selections, ...depreciation.selections]) : [],
        ...(isQuarterly ? {} : {
          grossProfit: gross?.profit ?? null,
          grossMarginBase: gross?.base ?? null,
          grossMargin: gross ? (gross.profit / gross.base) * 100 : null,
          grossProfitFactIds: gross ? register(gross.profitSelections) : [],
          grossMarginBaseFactIds: gross ? register(gross.baseSelections) : [],
        }),
      };
    });
  }

  const annualTrends = trend(revenueAnnual, operatingAnnual, depreciationAnnual, false).slice(-3);
  const quarterlyTrends = trend(revenueQuarterly, operatingQuarterly, depreciationQuarterly, true).slice(-8);
  const latestAnnual = annualTrends.at(-1);
  const latestAnnualRevenue = revenueAnnual.at(-1);
  const latestGross = latestAnnualRevenue ? grossForPeriod(latestAnnualRevenue) : null;
  const latestGrossProfitFact = latestAnnual?.grossProfitFactIds?.length === 1
    ? factMap.get(latestAnnual.grossProfitFactIds[0]) : undefined;
  const latestEbitdaFact = latestAnnual?.ebitdaFactIds.length === 1
    ? factMap.get(latestAnnual.ebitdaFactIds[0]) : undefined;
  const isReportedEbitda = Boolean(latestEbitdaFact?.concept.endsWith(":EarningsBeforeInterestTaxesDepreciationAndAmortization") ||
    latestEbitdaFact?.concept.endsWith(":EBITDA"));

  function balancePair(series: Series[]): [Series, Series] | null {
    if (!latestAnnualRevenue) return null;
    const current = pointForEnd(series, latestAnnualRevenue.end);
    const prior = series.filter((point) => point.end < latestAnnualRevenue.end &&
      Math.abs(days(point.end, latestAnnualRevenue.end) - 365) <= 45).at(-1);
    return current && prior && current.value >= 0 && prior.value >= 0 ? [current, prior] : null;
  }
  const inventoryPair = balancePair(inventory);
  const receivablesPair = balancePair(receivables);
  const fiscalDays = latestAnnualRevenue?.start ? days(latestAnnualRevenue.start, latestAnnualRevenue.end) + 1 : null;
  const inventoryDays = inventoryPair && latestGross?.cost && latestGross.cost > 0 && fiscalDays
    ? ((inventoryPair[0].value + inventoryPair[1].value) / 2 / latestGross.cost) * fiscalDays : null;
  const receivablesDays = receivablesPair && latestGross?.base && latestGross.base > 0 && fiscalDays
    ? ((receivablesPair[0].value + receivablesPair[1].value) / 2 / latestGross.base) * fiscalDays : null;
  const latestCash = cash;
  const latestDebtEnd = currentDebtSeries.map((point) => point.end).filter((end) => noncurrentDebtSeries.some((point) => point.end === end)).sort().at(-1);
  const currentDebt = latestDebtEnd ? pointForEnd(currentDebtSeries, latestDebtEnd) ?? null : null;
  const noncurrentDebt = latestDebtEnd ? pointForEnd(noncurrentDebtSeries, latestDebtEnd) ?? null : null;
  const shortDebt = latestDebtEnd ? pointForEnd(shortDebtSeries, latestDebtEnd) ?? null : null;
  const totalDebt = currentDebt && noncurrentDebt ? currentDebt.value + noncurrentDebt.value + (shortDebt?.value ?? 0) : null;
  const debtSelections = currentDebt && noncurrentDebt
    ? [...currentDebt.selections, ...noncurrentDebt.selections, ...(shortDebt?.selections ?? [])] : [];
  const debtNote = shortDebt
    ? "Includes reported short-term borrowings; excludes lease obligations."
    : "Long-term debt subtotal only; short-term borrowings were not mapped. Excludes lease obligations.";
  const trailingFour = quarterlyTrends.slice(-4);
  const consecutive = trailingFour.slice(1).every((point, index) => days(trailingFour[index].end, point.end) >= 70 && days(trailingFour[index].end, point.end) <= 110);
  const ttmEbitda = trailingFour.length === 4 && consecutive && trailingFour.every((point) => point.ebitda !== null)
    ? trailingFour.reduce((sum, point) => sum + (point.ebitda ?? 0), 0)
    : null;
  const ttmAligned = Boolean(latestDebtEnd && trailingFour.at(-1)?.end === latestDebtEnd);
  const annualAligned = Boolean(latestDebtEnd && latestAnnual?.end === latestDebtEnd);
  const leverageEbitda = annualAligned && isReportedEbitda ? latestAnnual?.ebitda ?? null
    : ttmAligned ? ttmEbitda : annualAligned ? latestAnnual?.ebitda ?? null : null;
  const leverageInputs = annualAligned && isReportedEbitda ? latestAnnual?.ebitdaFactIds ?? []
    : ttmAligned ? trailingFour.flatMap((point) => point.ebitdaFactIds)
      : annualAligned ? latestAnnual?.ebitdaFactIds ?? [] : [];
  const metrics: Metric[] = [
    {
      id: "revenue", label: "Revenue", period: latestAnnual?.period ?? "Latest FY", value: latestAnnual?.revenue ?? null,
      unit: "USD", formula: "Reported annual revenue", inputFactIds: latestAnnual?.revenueFactIds ?? [],
      status: latestAnnual?.revenue != null ? "reported" : "unavailable",
    },
    {
      id: "revenue-growth", label: "Revenue growth", period: latestAnnual?.period ?? "Latest FY",
      value: latestAnnual?.revenueYoY ?? null, unit: "percent", formula: "Current FY revenue / prior FY revenue − 1",
      inputFactIds: annualTrends.slice(-2).flatMap((point) => point.revenueFactIds),
      status: latestAnnual?.revenueYoY != null ? "calculated" : "unavailable",
    },
    {
      id: "gross-profit", label: "Gross profit", period: latestAnnual?.period ?? "Latest FY",
      value: latestAnnual?.grossProfit ?? null, unit: "USD",
      formula: latestGrossProfitFact?.concept === "GrossProfit" ? "Reported gross profit" : "Compatible sales base − cost of revenue or sales",
      inputFactIds: latestAnnual?.grossProfitFactIds ?? [],
      status: latestAnnual?.grossProfit == null ? "unavailable" : latestGrossProfitFact?.concept === "GrossProfit" ? "reported" : "calculated",
      note: "Gross margin may use a narrower net-sales base than headline total revenue. See cited source concepts.",
    },
    {
      id: "gross-margin", label: "Gross margin", period: latestAnnual?.period ?? "Latest FY",
      value: latestAnnual?.grossMargin ?? null, unit: "percent", formula: "Gross profit / compatible sales base",
      inputFactIds: [...(latestAnnual?.grossProfitFactIds ?? []), ...(latestAnnual?.grossMarginBaseFactIds ?? [])],
      status: latestAnnual?.grossMargin == null ? "unavailable" : "calculated",
      note: "The denominator follows the cited sales concept used to calculate or reconcile gross profit.",
    },
    {
      id: "ebitda", label: isReportedEbitda ? "Reported EBITDA" : "Estimated EBITDA", period: latestAnnual?.period ?? "Latest FY", value: latestAnnual?.ebitda ?? null,
      unit: "USD", formula: isReportedEbitda ? "Filing-reported EBITDA (issuer definition)" : "Operating income + depreciation and amortization",
      inputFactIds: latestAnnual?.ebitdaFactIds ?? [],
      status: latestAnnual?.ebitda == null ? "unavailable" : isReportedEbitda ? "reported" : "estimated",
      note: isReportedEbitda ? "Issuer-reported measure; review the filing definition before comparison or covenant use."
        : "This is a standardized estimate, not a company-reported or covenant-defined EBITDA.",
    },
    {
      id: "ebitda-margin", label: "Estimated EBITDA margin", period: latestAnnual?.period ?? "Latest FY",
      value: latestAnnual?.ebitda != null && latestAnnual.revenue ? (latestAnnual.ebitda / latestAnnual.revenue) * 100 : null,
      unit: "percent", formula: isReportedEbitda ? "Reported EBITDA / revenue" : "Estimated EBITDA / revenue",
      inputFactIds: [...(latestAnnual?.ebitdaFactIds ?? []), ...(latestAnnual?.revenueFactIds ?? [])],
      status: latestAnnual?.ebitda != null && latestAnnual.revenue ? isReportedEbitda ? "calculated" : "estimated" : "unavailable",
    },
    {
      id: "cash", label: "Cash and equivalents", period: latestCash?.end ?? "Latest filing", value: latestCash?.value ?? null,
      unit: "USD", formula: "Reported cash and cash equivalents", inputFactIds: latestCash ? register(latestCash.selections) : [],
      status: latestCash ? "reported" : "unavailable",
    },
    {
      id: "inventory-days", label: "Inventory days on hand", period: latestAnnual?.period ?? "Latest FY", value: inventoryDays,
      unit: "days", formula: "Average beginning/end inventory / FY cost of sales × FY days",
      inputFactIds: inventoryPair && latestGross?.costSelections
        ? [...register(inventoryPair.flatMap((point) => point.selections)), ...register(latestGross.costSelections)] : [],
      status: inventoryDays == null ? "unavailable" : "calculated",
      unavailableReason: inventoryDays == null ? "Requires two comparable FY inventory balances and same-period reported cost of sales." : undefined,
    },
    {
      id: "receivables-days", label: "Receivables days on hand", period: latestAnnual?.period ?? "Latest FY", value: receivablesDays,
      unit: "days", formula: "Average beginning/end net trade receivables / compatible FY sales base × FY days",
      inputFactIds: receivablesPair && latestGross
        ? [...register(receivablesPair.flatMap((point) => point.selections)), ...register(latestGross.baseSelections)] : [],
      status: receivablesDays == null ? "unavailable" : "calculated",
      unavailableReason: receivablesDays == null ? "Requires two comparable FY net trade receivable balances and a cited sales base." : undefined,
    },
    {
      id: "debt", label: shortDebt ? "Interest-bearing debt" : "Long-term debt subtotal", period: latestDebtEnd ?? "Latest filing", value: totalDebt,
      unit: "USD", formula: shortDebt ? "Short-term borrowings + current and noncurrent long-term debt" : "Current + noncurrent long-term debt",
      inputFactIds: register(debtSelections),
      status: totalDebt !== null ? "calculated" : "unavailable",
      note: totalDebt === null ? "Both long-term debt components must be reported for the same date." : debtNote,
    },
    {
      id: "leverage", label: shortDebt ? "Gross leverage estimate" : "Long-term leverage estimate", period: latestDebtEnd ?? "Latest filing",
      value: totalDebt !== null && leverageEbitda && leverageEbitda > 0 ? totalDebt / leverageEbitda : null,
      unit: "multiple", formula: annualAligned && isReportedEbitda ? "Included debt / same-date filing-reported EBITDA"
        : ttmAligned ? "Included debt / trailing-four-quarter estimated EBITDA" : "Included debt / same-date FY estimated EBITDA",
      inputFactIds: [...register(debtSelections), ...leverageInputs],
      status: totalDebt !== null && leverageEbitda && leverageEbitda > 0 ? "estimated" : "unavailable",
      note: `${debtNote} Not a covenant-defined leverage ratio.`,
    },
    {
      id: "fccr", label: "Fixed charge coverage", period: "Definition pending", value: null,
      unit: "multiple", formula: "Pending client-approved definition and input mapping", inputFactIds: [], status: "unavailable",
      note: "No ratio is calculated until Ashley approves the formula and required debt-service inputs.",
    },
  ];

  if (!depreciationConcept && latestAnnual?.ebitda == null) warnings.push("Depreciation and amortization could not be mapped to a standard SEC fact; EBITDA is unavailable.");
  if (totalDebt === null) warnings.push("Gross debt is unavailable because same-date current and noncurrent components were not both found.");
  if (!latestAnnual) warnings.push("Annual revenue could not be mapped to a standard SEC fact.");
  if (latestAnnual && latestAnnual.grossMargin == null) warnings.push("Gross margin is unavailable without a compatible same-period gross profit or sales-and-cost basis.");
  if (!ttmAligned && !annualAligned) warnings.push("Leverage is unavailable because debt and EBITDA periods do not align.");

  return {
    facts: [...factMap.values()], metrics, annualTrends, quarterlyTrends,
    sources: [...sourceMap.values()], periodLabel: latestAnnual?.period ?? "Period unavailable", warnings,
  };
}
