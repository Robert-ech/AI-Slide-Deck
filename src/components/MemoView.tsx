"use client";

import type { FinancialFact, Memo, Metric, Source, TrendPoint } from "@/lib/types";

export type LayoutStyle = "classic" | "brief" | "ledger";

function money(value: number | null): string {
  if (value === null) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

function metricValue(metric: Metric): string {
  if (metric.value === null) return "N/A";
  if (metric.unit === "USD") return money(metric.value);
  if (metric.unit === "percent") return `${metric.value.toFixed(1)}%`;
  return `${metric.value.toFixed(2)}×`;
}

function dateLabel(value: string): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function sourceIds(factIds: string[], facts: FinancialFact[]): string[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact.sourceId]));
  return [...new Set(factIds.map((id) => byId.get(id)).filter((id): id is string => Boolean(id)))];
}

function MetricTable({ metrics, facts, sources }: { metrics: Metric[]; facts: FinancialFact[]; sources: Source[] }) {
  return <div className="metric-table" role="table" aria-label="Financial and credit metrics">
    {metrics.map((metric) => <div className="metric-row" role="row" key={metric.id} title={`${metric.formula}${metric.note ? ` — ${metric.note}` : ""}`}>
      <div role="cell"><span className="metric-name">{metric.label}</span><small>{metric.period}</small></div>
      <strong role="cell">{metricValue(metric)} {metric.value !== null && <Citation ids={sourceIds(metric.inputFactIds, facts)} sources={sources} />}</strong>
      <span className={`metric-status ${metric.status}`} role="cell">{metric.status}</span>
    </div>)}
  </div>;
}

function TrendChart({ points, quarterly, facts, sources }: { points: TrendPoint[]; quarterly: TrendPoint[]; facts: FinancialFact[]; sources: Source[] }) {
  const visible = points.slice(-3);
  const values = visible.flatMap((point) => [point.revenueYoY, point.ebitdaYoY]).filter((value): value is number => value !== null);
  const scale = Math.max(10, ...values.map((value) => Math.abs(value)));
  return <div className="trend-chart" aria-label="Year over year revenue and estimated EBITDA growth chart">
    <div className="chart-legend"><span><i className="legend-revenue" /> Revenue YoY</span><span><i className="legend-ebitda" /> Est. EBITDA YoY</span></div>
    {visible.map((point) => <div className="chart-row" key={point.end}>
      <div className="chart-year">{point.period}</div>
      <div className="chart-bars">
        {[{ value: point.revenueYoY, className: "revenue" }, { value: point.ebitdaYoY, className: "ebitda" }].map((item, index) => <div className="bar-track" key={index}>
          <span className={`bar-fill ${item.className} ${item.value !== null && item.value < 0 ? "negative" : ""}`} style={{ width: item.value === null ? "0%" : `${Math.max(5, Math.abs(item.value) / scale * 74)}%` }} />
          <span className="bar-value">{item.value === null ? "—" : `${item.value > 0 ? "+" : ""}${item.value.toFixed(1)}%`}</span>
        </div>)}
      </div>
    </div>)}
    {quarterly.length > 0 && <p className="quarter-callout">Latest quarter · {quarterly.at(-1)?.period.replace("Q ", "ended ")} · revenue {money(quarterly.at(-1)!.revenue)}{quarterly.at(-1)?.revenueYoY !== null ? ` · ${quarterly.at(-1)!.revenueYoY!.toFixed(1)}% YoY` : " · YoY unavailable"} · estimated EBITDA {money(quarterly.at(-1)!.ebitda)}</p>}
    <p className="chart-footnote">EBITDA is an estimate from operating income plus depreciation and amortization. <Citation ids={sourceIds([...visible.flatMap((point) => [...point.revenueFactIds, ...point.ebitdaFactIds]), ...(quarterly.at(-1)?.revenueFactIds ?? []), ...(quarterly.at(-1)?.ebitdaFactIds ?? [])], facts)} sources={sources} /></p>
  </div>;
}

function Citation({ ids, sources }: { ids: string[]; sources: Source[] }) {
  const matches = ids.map((id) => sources.find((source) => source.id === id)).filter((source): source is Source => Boolean(source));
  if (!matches.length) return <span className="citation missing">Source review needed</span>;
  return <span className="citation">{matches.map((source, index) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id} title={source.title}>[{sources.indexOf(source) + 1}]{index < matches.length - 1 ? " " : ""}</a>)}</span>;
}

export default function MemoView({ memo, layout }: { memo: Memo; layout: LayoutStyle }) {
  const generated = dateLabel(memo.generatedAt);
  const companyDescription = memo.company.description || "Public company";
  return <article className={`memo-paper memo-${layout}`} id="print-memo">
    <header className="memo-header">
      <div className="memo-overline"><span>COMPANY RESEARCH / CREDIT SNAPSHOT</span><span>{memo.reviewStatus === "reviewed" ? "REVIEWED" : "DRAFT · ANALYST REVIEW REQUIRED"}</span></div>
      <div className="memo-title-line"><div><h1>{memo.company.name}</h1><p>{memo.company.ticker} <span>•</span> {companyDescription}</p></div><div className="memo-asof"><b>AS OF</b><span>{generated}</span><small>{memo.periodLabel}</small></div></div>
    </header>

    <div className="memo-body">
      <section className="memo-section metrics-section"><div className="section-heading"><span>01</span><h2>Financial profile</h2></div><MetricTable metrics={memo.metrics} facts={memo.facts} sources={memo.sources} /></section>
      <section className="memo-section chart-section"><div className="section-heading"><span>02</span><h2>Operating momentum</h2></div><TrendChart points={memo.annualTrends} quarterly={memo.quarterlyTrends} facts={memo.facts} sources={memo.sources} /></section>
      <section className="memo-section insights-section"><div className="section-heading"><span>03</span><h2>Analyst takeaways</h2></div><ol className="insight-list">
        {memo.insights.map((insight) => <li key={insight.id}><span className="insight-kind">{insight.kind}</span><p>{insight.text} <Citation ids={insight.evidenceIds} sources={memo.sources} /></p></li>)}
      </ol></section>
      {memo.industry && <section className="memo-section industry-section"><div className="section-heading"><span>04</span><h2>Industry lens</h2></div><p className="industry-title">{memo.industry.reportTitle} · IBISWorld {memo.industry.reportCode}</p><p className="industry-copy">{memo.industry.summary}</p><small>Licensed material. Local analyst reference only; excluded from AI generation. <Citation ids={[memo.industry.sourceId]} sources={memo.sources} /></small></section>}
    </div>

    <footer className="memo-footer"><span>Public filings are the source for financial values. Estimated ratios are not covenant calculations.</span><span>FIELDNOTE / {memo.company.ticker}</span></footer>
  </article>;
}
