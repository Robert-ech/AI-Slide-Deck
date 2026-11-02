import assert from "node:assert/strict";
import test from "node:test";
import { buildFinancials } from "../src/lib/financials";
import type { CompanyFacts, Submissions, XbrlEntry } from "../src/lib/sec";

const cik = "0000001234";
let accession = 0;
const filingAccessions = new Map<string, string>();
function resetRows() { accession = 0; filingAccessions.clear(); }
function row(start: string | undefined, end: string, val: number, form: "10-K" | "10-Q", fp: string): XbrlEntry {
  const filing = `${form}:${end}`;
  if (!filingAccessions.has(filing)) {
    accession += 1;
    filingAccessions.set(filing, `0000001234-25-${String(accession).padStart(6, "0")}`);
  }
  return { start, end, val, form, fp, fy: Number(end.slice(0, 4)), filed: `${Number(end.slice(0, 4)) + 1}-02-01`, accn: filingAccessions.get(filing)! };
}
function fixture(withDepreciation = true): { facts: CompanyFacts; submissions: Submissions } {
  resetRows();
  function duration(annual2024: number, annual2025: number, q2024: number[], q2025: number[]) {
    const result: XbrlEntry[] = [];
    for (const [year, annualValue, quarters] of [[2024, annual2024, q2024], [2025, annual2025, q2025]] as const) {
      const start = `${year}-01-01`;
      result.push(row(start, `${year}-03-31`, quarters[0], "10-Q", "Q1"));
      result.push(row(start, `${year}-06-30`, quarters[0] + quarters[1], "10-Q", "Q2"));
      result.push(row(start, `${year}-09-30`, quarters[0] + quarters[1] + quarters[2], "10-Q", "Q3"));
      result.push(row(start, `${year}-12-31`, annualValue, "10-K", "FY"));
    }
    return { label: "Test", units: { USD: result } };
  }
  const gaap: CompanyFacts["facts"]["us-gaap"] = {
    RevenueFromContractWithCustomerExcludingAssessedTax: duration(100, 120, [20, 25, 25, 30], [24, 30, 30, 36]),
    OperatingIncomeLoss: duration(20, 24, [4, 5, 5, 6], [4, 5, 5, 10]),
    CashAndCashEquivalentsAtCarryingValue: { label: "Cash", units: { USD: [row(undefined, "2025-12-31", 10, "10-K", "FY")] } },
    LongTermDebtCurrent: { label: "Current debt", units: { USD: [row(undefined, "2025-12-31", 5, "10-K", "FY")] } },
    LongTermDebtNoncurrent: { label: "Long debt", units: { USD: [row(undefined, "2025-12-31", 15, "10-K", "FY")] } },
  };
  if (withDepreciation) gaap.DepreciationDepletionAndAmortization = duration(10, 12, [2, 2, 2, 4], [2, 3, 3, 4]);
  const facts: CompanyFacts = { cik: 1234, entityName: "Test Co", facts: { "us-gaap": gaap } };
  const submissions: Submissions = { name: "Test Co", filings: { recent: { accessionNumber: [], primaryDocument: [] } } };
  return { facts, submissions };
}

test("derives standalone Q4 and credit ratios from aligned filing facts", () => {
  const { facts, submissions } = fixture();
  const result = buildFinancials(cik, facts, submissions);
  const metric = (id: string) => result.metrics.find((item) => item.id === id)!;
  assert.equal(metric("revenue").value, 120);
  assert.ok(Math.abs((metric("revenue-growth").value ?? 0) - 20) < 1e-9);
  assert.equal(metric("ebitda").value, 36);
  assert.equal(metric("debt").value, 20);
  assert.ok(Math.abs((metric("leverage").value ?? 0) - 20 / 36) < 1e-9);
  assert.equal(metric("fccr").value, null);
  assert.equal(result.quarterlyTrends.at(-1)?.revenue, 36);
  assert.ok(Math.abs((result.quarterlyTrends.at(-1)?.revenueYoY ?? 0) - 20) < 1e-9);
  assert.ok(result.facts.length > 0 && result.sources.length > 0);
  assert.ok(metric("leverage").inputFactIds.length > 2);
});

test("does not invent EBITDA or leverage when depreciation is missing", () => {
  const { facts, submissions } = fixture(false);
  const result = buildFinancials(cik, facts, submissions);
  assert.equal(result.metrics.find((item) => item.id === "ebitda")?.status, "unavailable");
  assert.equal(result.metrics.find((item) => item.id === "leverage")?.value, null);
  assert.match(result.warnings.join(" "), /Depreciation/);
});

test("does not combine facts whose fiscal periods only share an end date", () => {
  const { facts, submissions } = fixture();
  const operating = facts.facts["us-gaap"].OperatingIncomeLoss.units.USD;
  const fy2025 = operating.find((entry) => entry.end === "2025-12-31" && entry.fp === "FY")!;
  fy2025.start = "2025-02-01";
  const result = buildFinancials(cik, facts, submissions);
  assert.equal(result.metrics.find((item) => item.id === "ebitda")?.value, null);
  assert.equal(result.metrics.find((item) => item.id === "leverage")?.value, null);
  assert.equal(result.annualTrends.at(-1)?.ebitda, null);
  assert.equal(result.quarterlyTrends.at(-1)?.ebitda, null);
});

test("derived Q4 retains both same-start filing inputs", () => {
  const { facts, submissions } = fixture();
  const result = buildFinancials(cik, facts, submissions);
  const q4 = result.quarterlyTrends.at(-1)!;
  const inputs = q4.revenueFactIds.map((id) => result.facts.find((fact) => fact.id === id)!);
  assert.equal(q4.revenue, 36);
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs.map((input) => [input.start, input.end]), [
    ["2025-01-01", "2025-12-31"],
    ["2025-01-01", "2025-09-30"],
  ]);
});

test("Walmart benchmark uses total revenues, includes short borrowings, and keeps filing provenance", () => {
  resetRows();
  const annual = (values: [number, number, number]) => ({
    label: "Reported", units: { USD: values.map((value, index) =>
      row(`${2023 + index}-02-01`, `${2024 + index}-01-31`, value * 1e6, "10-K", "FY")) },
  });
  const instant = (value: number) => ({ label: "Reported", units: { USD: [row(undefined, "2026-01-31", value * 1e6, "10-K", "FY")] } });
  const gaap: CompanyFacts["facts"]["us-gaap"] = {
    Revenues: annual([648125, 680985, 713163]),
    RevenueFromContractWithCustomerExcludingAssessedTax: annual([642637, 674538, 706413]),
    CostOfGoodsAndServicesSold: annual([490142, 511753, 535395]),
    GrossProfit: annual([152495, 162785, 171018]),
    OperatingIncomeLoss: annual([27012, 29348, 29825]),
    DepreciationDepletionAndAmortization: annual([11853, 12973, 14203]),
    CashAndCashEquivalentsAtCarryingValue: instant(10727),
    ShortTermBorrowings: instant(6596),
    LongTermDebtCurrent: instant(3542),
    LongTermDebtNoncurrent: instant(34624),
  };
  const facts: CompanyFacts = { cik: 104169, entityName: "Walmart Inc.", facts: { "us-gaap": gaap } };
  const submissions: Submissions = { name: "Walmart Inc.", filings: { recent: { accessionNumber: [], primaryDocument: [] } } };
  const result = buildFinancials("0000104169", facts, submissions);
  const metric = (id: string) => result.metrics.find((item) => item.id === id)!;
  assert.equal(metric("revenue").value, 713163e6);
  assert.equal(metric("gross-profit").value, 171018e6);
  assert.ok(Math.abs((metric("gross-margin").value ?? 0) - 171018 / 706413 * 100) < 1e-9);
  assert.equal(result.annualTrends.at(-1)?.grossMarginBase, 706413e6);
  assert.equal(metric("gross-profit").status, "reported");
  assert.equal(result.facts.find((fact) => fact.id === result.annualTrends.at(-1)?.grossMarginBaseFactIds?.[0])?.concept,
    "RevenueFromContractWithCustomerExcludingAssessedTax");
  assert.equal(metric("ebitda").value, 44028e6);
  assert.equal(metric("debt").value, 44762e6);
  assert.ok(Math.abs((metric("leverage").value ?? 0) - 44762 / 44028) < 1e-9);
  assert.equal(metric("cash").value, 10727e6);
  assert.equal(metric("fccr").status, "unavailable");
  assert.equal(metric("revenue").inputFactIds.length, 1);
  assert.equal(result.facts.find((fact) => fact.id === metric("revenue").inputFactIds[0])?.concept, "Revenues");
  assert.ok(result.sources.every((source) => source.url.startsWith("https://www.sec.gov/Archives/edgar/")));
});

test("Microsoft-style gross margin uses total revenue and can derive gross profit from cost", () => {
  const { facts, submissions } = fixture();
  const gaap = facts.facts["us-gaap"];
  gaap.Revenues = { label: "Revenue", units: { USD: [row("2025-01-01", "2025-12-31", 120, "10-K", "FY")] } };
  gaap.CostOfRevenue = { label: "Cost of revenue", units: { USD: [row("2025-01-01", "2025-12-31", 40, "10-K", "FY")] } };
  const result = buildFinancials(cik, facts, submissions);
  assert.equal(result.metrics.find((item) => item.id === "gross-profit")?.value, 80);
  assert.ok(Math.abs((result.metrics.find((item) => item.id === "gross-margin")?.value ?? 0) - 80 / 120 * 100) < 1e-9);
  assert.equal(result.metrics.find((item) => item.id === "gross-profit")?.status, "calculated");
});

test("gross margin is unavailable when cost does not share the sales period or filing", () => {
  const { facts, submissions } = fixture();
  const gaap = facts.facts["us-gaap"];
  const cost = row("2025-01-01", "2025-12-31", 40, "10-K", "FY");
  cost.start = "2025-02-01";
  gaap.CostOfRevenue = { label: "Cost of revenue", units: { USD: [cost] } };
  let result = buildFinancials(cik, facts, submissions);
  assert.equal(result.metrics.find((item) => item.id === "gross-margin")?.value, null);

  cost.start = "2025-01-01";
  cost.accn = "0000001234-25-999999";
  result = buildFinancials(cik, facts, submissions);
  assert.equal(result.metrics.find((item) => item.id === "gross-margin")?.value, null);
});

test("verified filing-reported EBITDA takes precedence over the standardized estimate", () => {
  const { facts, submissions } = fixture();
  facts.facts.testco = {
    EBITDA: { label: "EBITDA", units: { USD: [
      row("2024-01-01", "2024-12-31", 38, "10-K", "FY"),
      row("2025-01-01", "2025-12-31", 45, "10-K", "FY"),
    ] } },
  };
  const result = buildFinancials(cik, facts, submissions);
  const ebitda = result.metrics.find((item) => item.id === "ebitda")!;
  assert.equal(ebitda.value, 45);
  assert.equal(ebitda.status, "reported");
  assert.equal(ebitda.label, "Reported EBITDA");
  assert.equal(result.annualTrends.at(-1)?.ebitda, 45);
  assert.ok(Math.abs((result.metrics.find((item) => item.id === "leverage")?.value ?? 0) - 20 / 45) < 1e-9);
  assert.equal(result.facts.find((fact) => fact.id === ebitda.inputFactIds[0])?.concept, "testco:EBITDA");
});

test("adjusted EBITDA labels do not supersede the filing-based estimate", () => {
  const { facts, submissions } = fixture();
  facts.facts.testco = {
    EBITDA: { label: "Adjusted EBITDA", units: { USD: [row("2025-01-01", "2025-12-31", 60, "10-K", "FY")] } },
  };
  const result = buildFinancials(cik, facts, submissions);
  assert.equal(result.metrics.find((item) => item.id === "ebitda")?.value, 36);
  assert.equal(result.metrics.find((item) => item.id === "ebitda")?.status, "estimated");
});

test("conflicting issuer EBITDA facts do not silently choose a reported value", () => {
  const { facts, submissions } = fixture();
  facts.facts.issuerOne = { EBITDA: { label: "EBITDA", units: { USD: [row("2025-01-01", "2025-12-31", 45, "10-K", "FY")] } } };
  facts.facts.issuerTwo = { EBITDA: { label: "EBITDA", units: { USD: [row("2025-01-01", "2025-12-31", 50, "10-K", "FY")] } } };
  const result = buildFinancials(cik, facts, submissions);
  assert.equal(result.metrics.find((item) => item.id === "ebitda")?.value, 36);
  assert.equal(result.metrics.find((item) => item.id === "ebitda")?.status, "estimated");
});

test("working-capital days use two FY balances and the compatible revenue/cost basis", () => {
  const { facts, submissions } = fixture();
  const gaap = facts.facts["us-gaap"];
  gaap.CostOfRevenue = { label: "Cost of revenue", units: { USD: [row("2025-01-01", "2025-12-31", 40, "10-K", "FY")] } };
  gaap.InventoryNet = { label: "Inventory", units: { USD: [
    row(undefined, "2024-12-31", 16, "10-K", "FY"),
    row(undefined, "2025-12-31", 20, "10-K", "FY"),
  ] } };
  gaap.AccountsReceivableNetCurrent = { label: "Net receivables", units: { USD: [
    row(undefined, "2024-12-31", 24, "10-K", "FY"),
    row(undefined, "2025-12-31", 30, "10-K", "FY"),
  ] } };
  const result = buildFinancials(cik, facts, submissions);
  const inventory = result.metrics.find((item) => item.id === "inventory-days")!;
  const receivables = result.metrics.find((item) => item.id === "receivables-days")!;
  assert.ok(Math.abs((inventory.value ?? 0) - 18 / 40 * 365) < 1e-9);
  assert.ok(Math.abs((receivables.value ?? 0) - 27 / 120 * 365) < 1e-9);
  assert.equal(inventory.inputFactIds.length, 3);
  assert.equal(receivables.inputFactIds.length, 3);
});

test("working-capital metrics stay unavailable without two comparable FY balances", () => {
  const { facts, submissions } = fixture();
  const result = buildFinancials(cik, facts, submissions);
  for (const id of ["inventory-days", "receivables-days"]) {
    const metric = result.metrics.find((item) => item.id === id)!;
    assert.equal(metric.value, null);
    assert.match(metric.unavailableReason ?? "", /two comparable FY/);
  }
});
