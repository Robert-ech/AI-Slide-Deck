import { existsSync } from "node:fs";
import { getSecBundle } from "../src/lib/sec";
import { buildFinancials } from "../src/lib/financials";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const benchmarks: Record<string, Record<string, number>> = {
  WMT: { revenue: 713163e6, "revenue-growth": (713163 / 680985 - 1) * 100, "gross-profit": 171018e6,
    "gross-margin": (171018 / 706413) * 100, ebitda: 44028e6, cash: 10727e6, debt: 44762e6, leverage: 44762 / 44028 },
  MSFT: { revenue: 331839e6, "revenue-growth": (331839 / 281724 - 1) * 100, "gross-profit": 225465e6,
    "gross-margin": (225465 / 331839) * 100, cash: 20935e6, debt: 40294e6 },
};
const grossMarginBases: Record<string, number> = { WMT: 706413e6, MSFT: 331839e6 };

async function main() {
  for (const ticker of ["WMT", "MSFT"]) {
    const bundle = await getSecBundle(ticker);
    const result = buildFinancials(bundle.company.cik, bundle.facts, bundle.submissions);
    const mismatches: string[] = [];
    const factsById = new Map(result.facts.map((fact) => [fact.id, fact]));
    const sourceIds = new Set(result.sources.map((source) => source.id));
    for (const [id, expected] of Object.entries(benchmarks[ticker])) {
      const metric = result.metrics.find((item) => item.id === id);
      const tolerance = id.includes("growth") || id.includes("margin") || id === "leverage" ? 0.005 : 500_000;
      if (metric?.value == null || Math.abs(metric.value - expected) > tolerance) {
        mismatches.push(`${id}: expected ${expected}, got ${metric?.value ?? "N/A"}`);
      }
    }
    const grossBase = result.annualTrends.at(-1)?.grossMarginBase;
    if (grossBase == null || Math.abs(grossBase - grossMarginBases[ticker]) > 500_000) {
      mismatches.push(`gross-margin base: expected ${grossMarginBases[ticker]}, got ${grossBase ?? "N/A"}`);
    }
    for (const metric of result.metrics) {
      if (metric.value === null && !metric.unavailableReason) mismatches.push(`${metric.id}: N/A reason missing`);
      if (metric.value !== null && metric.inputFactIds.length === 0) mismatches.push(`${metric.id}: available value has no filing inputs`);
      for (const id of metric.inputFactIds) {
        const fact = factsById.get(id);
        if (!fact || !sourceIds.has(fact.sourceId)) mismatches.push(`${metric.id}: unresolved fact/source ${id}`);
      }
    }
    console.log(JSON.stringify({
      ticker,
      company: bundle.company.name,
      period: result.periodLabel,
      metrics: result.metrics.map(({ id, value, period, status, unavailableReason }) => ({ id, value, period, status, unavailableReason })),
      benchmark: mismatches.length ? { status: "mismatch", mismatches } : { status: "match" },
      warnings: result.warnings,
    }, null, 2));
    if (mismatches.length) process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
