"use client";

import type { FinancialFact, Memo, Metric, Source } from "@/lib/types";

function money(value: number | null): string {
  if (value === null) return "N/A";
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

function metricValue(metric?: Metric): string {
  if (!metric || metric.value === null) return "N/A";
  if (metric.unit === "USD") return money(metric.value);
  return metric.unit === "percent" ? `${metric.value.toFixed(1)}%` : `${metric.value.toFixed(2)}×`;
}

function factSources(ids: string[], facts: FinancialFact[]): string[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact.sourceId]));
  return [...new Set(ids.map((id) => byId.get(id)).filter((id): id is string => Boolean(id)))];
}

function Citation({ ids, sources }: { ids: string[]; sources: Source[] }) {
  const matches = ids.map((id) => sources.find((source) => source.id === id)).filter((source): source is Source => Boolean(source));
  if (!matches.length) return <span className="dossier-uncited">Source review needed</span>;
  return <span className="dossier-citations">{matches.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id} title={source.title}>[{sources.indexOf(source) + 1}]</a>)}</span>;
}

function PageFrame({ memo, page, title, children }: { memo: Memo; page: 1 | 2; title: string; children: React.ReactNode }) {
  return <article className="dossier-page" aria-label={`Memo page ${page}: ${title}`}>
    <header className="dossier-head">
      <div className="dossier-topline"><span>FIELDNOTE <i /> COMPANY RESEARCH</span><span>DS3 CONSULTING / PRIVATE PILOT</span></div>
      <div className="dossier-head-main"><div><span className="dossier-kicker">{page === 1 ? "FINANCIAL POSITION" : "BUSINESS PERSPECTIVE"} / 0{page}</span><h2>{title}</h2><p>{memo.company.name} <span>·</span> {memo.company.ticker} <span>·</span> {memo.periodLabel}</p></div><div className="dossier-head-side"><strong>{page}<span>/02</span></strong><small>{memo.reviewStatus === "reviewed" ? "REVIEWED" : "DRAFT · ANALYST REVIEW"}</small></div></div>
    </header>
    <div className="dossier-page-body">{children}</div>
    <footer className="dossier-foot"><span>Screening research · verify source material before use</span><span>{memo.company.ticker} / 0{page}</span></footer>
  </article>;
}

export default function MemoView({ memo }: { memo: Memo }) {
  const byId = new Map(memo.metrics.map((metric) => [metric.id, metric]));
  const slots = [
    { label: "Revenue", metric: byId.get("revenue") },
    { label: "Gross margin", metric: byId.get("gross-margin") },
    { label: byId.get("ebitda")?.status === "reported" ? "Reported EBITDA" : "Est. EBITDA", metric: byId.get("ebitda") },
    { label: "Cash", metric: byId.get("cash") },
    { label: "Debt", metric: byId.get("debt") },
    { label: "Gross leverage", metric: byId.get("leverage") },
  ];
  const annual = memo.annualTrends.slice(-3);
  const maxRevenue = Math.max(1, ...annual.map((point) => point.revenue ?? 0));
  const marginSourceIds = factSources(annual.flatMap((point) => [...(point.grossProfitFactIds ?? []), ...(point.grossMarginBaseFactIds ?? [])]), memo.facts);
  const completeMarginTrend = annual.length >= 2 && annual.every((point) => point.grossMargin != null && (point.grossProfitFactIds?.length ?? 0) > 0 && (point.grossMarginBaseFactIds?.length ?? 0) > 0);
  const marginValues = annual.map((point) => point.grossMargin ?? 0);
  const marginFloor = Math.floor(Math.min(...marginValues) - 1);
  const marginCeiling = Math.ceil(Math.max(...marginValues) + 1);
  const marginCoordinates = annual.map((point, index) => {
    const x = 12 + index * (276 / Math.max(1, annual.length - 1));
    const y = 40 - ((point.grossMargin! - marginFloor) / Math.max(1, marginCeiling - marginFloor)) * 30;
    return `${x},${y}`;
  }).join(" ");
  const coverage = byId.get("fccr");
  const performance = memo.insights.filter((insight) => ["performance", "growth", "context"].includes(insight.kind));
  const credit = memo.insights.filter((insight) => ["credit", "risk"].includes(insight.kind));
  const citedIds = new Set([
    ...slots.flatMap(({ metric }) => metric ? factSources(metric.inputFactIds, memo.facts) : []),
    ...factSources(annual.flatMap((point) => point.revenueFactIds), memo.facts),
    ...marginSourceIds,
    ...memo.insights.flatMap((insight) => insight.evidenceIds),
  ]);
  const citedPublicSources = memo.sources.filter((source) => source.access === "public" && citedIds.has(source.id));

  return <div className="dossier-preview" id="print-memo">
    <div className="dossier-preview-note"><span className="preview-pip" /> Two-page layout preview <span>·</span> Available figures are sourced; unfinished sections show N/A</div>
    <PageFrame memo={memo} page={1} title="Financial position">
      <div className="dossier-section-title"><span>01 / KEY MEASURES</span><p>Provisional priority · awaiting Ashley&apos;s ranking</p></div>
      <div className="dossier-metric-grid">{slots.map(({ label, metric }) => <div className={`dossier-metric ${metric?.value == null ? "is-missing" : ""}`} key={label}>
        <span>{label}</span><strong>{metricValue(metric)}</strong><small>{metric?.value == null ? metric?.unavailableReason ?? metric?.note ?? "Validated filing input unavailable" : metric.period}</small>
        {metric?.value != null && <Citation ids={factSources(metric.inputFactIds, memo.facts)} sources={memo.sources} />}
      </div>)}</div>
      <div className="dossier-coverage"><div><span>IMPORTANT FOR CREDIT</span><strong>Fixed charge coverage</strong></div><div><b>{metricValue(coverage)}</b><small>{coverage?.unavailableReason ?? "Definition and inputs pending client approval"}</small></div></div>
      <div className="dossier-chart-grid">
        <section className="dossier-panel revenue-panel" aria-label="Annual revenue and gross margin trend"><div className="dossier-panel-head"><div><span>02 / OPERATING TREND</span><h3>Revenue &amp; gross margin</h3></div><span className="panel-period">ANNUAL</span></div>
          <div className="dossier-revenue-chart">{annual.length ? annual.map((point) => <div className="dossier-revenue-row" key={point.end}><span>{point.period}</span><div className="dossier-revenue-track">{point.revenue != null && <i style={{ width: `${Math.max(4, point.revenue / maxRevenue * 100)}%` }} />}</div><b>{money(point.revenue)}</b><em>{completeMarginTrend ? `${point.grossMargin!.toFixed(1)}%` : "N/A"}</em></div>) : <div className="dossier-empty-data">Revenue N/A · Comparable annual facts unavailable</div>}</div>
          {completeMarginTrend && <div className="dossier-margin-line"><svg viewBox="0 0 300 49" role="img" aria-label={`Gross margin: ${annual.map((point) => `${point.period} ${point.grossMargin!.toFixed(1)} percent`).join(", ")}`}><path d="M12 44H288" className="margin-axis" /><polyline points={marginCoordinates} className="margin-path" />{marginCoordinates.split(" ").map((coordinate, index) => { const [cx, cy] = coordinate.split(","); return <circle key={annual[index].end} cx={cx} cy={cy} r="3" className="margin-point" />; })}</svg></div>}
          <div className="dossier-chart-legend"><span><i className="legend-swatch" /> Revenue <Citation ids={factSources(annual.flatMap((point) => point.revenueFactIds), memo.facts)} sources={memo.sources} /></span><span><i className="legend-dash" /> Gross margin {completeMarginTrend ? <Citation ids={marginSourceIds} sources={memo.sources} /> : "N/A"}</span></div>
          {!completeMarginTrend && <p className="dossier-panel-note">Gross margin N/A · Comparable revenue and gross profit inputs have not been validated for all shown years.</p>}
        </section>
        <section className="dossier-panel maturity-panel" aria-label="Debt maturity chart design; data unavailable"><div className="dossier-panel-head"><div><span>03 / DEBT PROFILE</span><h3>Debt maturities</h3></div><span className="panel-period">DESIGN PREVIEW</span></div><div className="dossier-maturity-skeleton" aria-hidden="true"><i /><i /><i /><i /><i /></div><div className="dossier-skeleton-labels" aria-hidden="true"><span>Y1</span><span>Y2</span><span>Y3</span><span>Y4</span><span>Y5+</span></div><p className="dossier-panel-note"><b>N/A</b> · Maturity schedule and senior/junior split await filing review. Outlined bars show layout only.</p></section>
      </div>
      <section className="dossier-panel trends-panel" aria-label="Google Trends chart design; data unavailable"><div><span>04 / EXTERNAL SIGNAL</span><h3>Google search interest</h3><p>Company-specific Google Trends data has not been added. The future chart will show interest over time with its query, region, period, and source.</p></div><div className="dossier-trends-design"><svg viewBox="0 0 150 42" aria-hidden="true"><path d="M0 41H150M0 20H150M0 1H150" className="trend-grid" /><path d="M1 31 23 29 45 33 66 15 87 22 108 9 129 18 149 7" className="trend-ghost" /></svg><strong>N/A · DESIGN ONLY</strong></div></section>
      <p className="dossier-method">EBITDA and leverage measures use the stated source and formula; estimates are not covenant calculations. Missing values are not inferred. Financial figures retain their filing trail.</p>
    </PageFrame>
    <PageFrame memo={memo} page={2} title="Business perspective">
      <div className="dossier-section-title"><span>05 / ANALYST READOUT</span><p>Why the numbers moved · what deserves follow-up</p></div>
      <div className="dossier-lede"><span>THE QUESTION</span><p>What does the evidence tell us about the company&apos;s financial position and the business behind it?</p></div>
      <div className="dossier-narrative-grid">
        <section className="dossier-narrative-section"><span>01</span><h3>Performance &amp; drivers</h3>{performance.length ? performance.map((insight) => <p key={insight.id}>{insight.text} <Citation ids={insight.evidenceIds} sources={memo.sources} /></p>) : <p>Source-backed explanation pending analyst research.</p>}</section>
        <section className="dossier-narrative-section"><span>02</span><h3>Credit view &amp; risks</h3>{credit.length ? credit.map((insight) => <p key={insight.id}>{insight.text} <Citation ids={insight.evidenceIds} sources={memo.sources} /></p>) : <p>Source-backed credit observations pending analyst research.</p>}</section>
      </div>
      <div className="dossier-followup"><div><span>OPPORTUNITIES / FOLLOW-UP</span><h3>Questions for the next pass</h3></div><p>Review drivers of revenue change, liquidity restrictions, debt maturities, and market demand with the underlying filings and public evidence. No opportunity conclusion has been asserted without a source.</p></div>
      <section className="dossier-source-section"><div className="dossier-section-title"><span>06 / SOURCE REGISTER</span><p>Numbered references used in this draft</p></div><ol>{citedPublicSources.map((source) => <li key={source.id}><span>[{memo.sources.indexOf(source) + 1}]</span><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{source.publishedAt ?? "Date unavailable"}</small></li>)}</ol></section>
      {memo.industry && <p className="dossier-industry-note">Licensed industry reference: {memo.industry.reportTitle}. This material remains local and is excluded from AI generation.</p>}
    </PageFrame>
  </div>;
}
