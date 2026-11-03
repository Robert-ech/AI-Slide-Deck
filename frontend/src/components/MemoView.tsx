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
  if (metric.unit === "percent") return `${metric.value.toFixed(1)}%`;
  if (metric.unit === "days") return `${metric.value.toFixed(1)} days`;
  return `${metric.value.toFixed(2)}×`;
}

function excerpt(text: string, maxLength = 250): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  const wordEnd = compact.lastIndexOf(" ", maxLength);
  return `${compact.slice(0, wordEnd > maxLength * .6 ? wordEnd : maxLength)}…`;
}

function factSources(ids: string[], facts: FinancialFact[]): string[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact.sourceId]));
  return [...new Set(ids.map((id) => byId.get(id)).filter((id): id is string => Boolean(id)))];
}

function Citation({ ids, sources }: { ids: string[]; sources: Source[] }) {
  const matches = [...new Set(ids)].map((id) => sources.find((source) => source.id === id)).filter((source): source is Source => Boolean(source));
  if (!matches.length || matches.length !== new Set(ids).size) return <span className="dossier-uncited">Source review needed</span>;
  return <span className="dossier-citations">{matches.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id} title={source.title} aria-label={`Source ${sources.indexOf(source) + 1}: ${source.title}`}>[{sources.indexOf(source) + 1}]</a>)}</span>;
}

function PageFrame({ memo, page, title, demo, children }: { memo: Memo; page: 1 | 2; title: string; demo: boolean; children: React.ReactNode }) {
  return <article className="dossier-page" id={page === 1 ? "financial-position" : "business-perspective"} aria-label={`Memo page ${page}: ${title}`}>
    <header className="dossier-head">
      <div className="dossier-topline"><span className="memo-brand"><img src="/brand/jpmorgan.svg" alt="J.P. Morgan" width="88" height="19" /><span>COMPANY RESEARCH</span></span><span>DS3 CONSULTING / {demo ? "PROJECT DEMO" : "PRIVATE PILOT"}</span></div>
      <div className="dossier-head-main"><div><span className="dossier-kicker">{page === 1 ? "FINANCIAL POSITION" : "BUSINESS PERSPECTIVE"} / 0{page}</span><h2>{title}</h2><p>{memo.company.name} <span>·</span> {memo.company.ticker} <span>·</span> {memo.periodLabel}</p></div><div className="dossier-head-side"><strong>{page}<span>/02</span></strong><small>{demo ? "DEMO · SAVED SAMPLE" : memo.reviewStatus === "reviewed" ? "REVIEWED" : "DRAFT · ANALYST REVIEW"}</small></div></div>
    </header>
    <div className="dossier-page-body">{children}</div>
    <footer className="dossier-foot"><span>{demo ? "DS3 Consulting project demo · Saved FY2026 example" : "Screening research · verify source material before use"}</span><span>{memo.company.ticker} / 0{page}</span></footer>
  </article>;
}

export default function MemoView({ memo, demo = false }: { memo: Memo; demo?: boolean }) {
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
  const maturity = memo.debtMaturities?.reviewed && memo.sources.some((source) => source.id === memo.debtMaturities?.sourceId) ? memo.debtMaturities : null;
  const maturityBuckets = maturity?.buckets.filter((bucket) => [bucket.senior, bucket.junior, bucket.unclassified].some((value) => value !== null)) ?? [];
  const maturityMaximum = Math.max(1, ...maturityBuckets.map((bucket) => (bucket.senior ?? 0) + (bucket.junior ?? 0) + (bucket.unclassified ?? 0)));
  const ratings = memo.creditRatings?.filter((rating) => rating.reviewed && memo.sources.some((source) => source.id === rating.sourceId)) ?? [];
  const trends = memo.googleTrends?.reviewed && memo.sources.some((source) => source.id === memo.googleTrends?.sourceId) ? memo.googleTrends : null;
  const trendPoints = trends?.points ?? [];
  const usableTrendPoints = trendPoints.filter((point) => point.interest !== null);
  const trendSegments: string[][] = [];
  trendPoints.forEach((point, index) => {
    if (point.interest === null) return;
    if (index === 0 || trendPoints[index - 1].interest === null) trendSegments.push([]);
    const x = 4 + index * (152 / Math.max(1, trendPoints.length - 1));
    const y = 45 - point.interest * .4;
    trendSegments.at(-1)?.push(`${x},${y}`);
  });
  const performance = memo.insights.filter((insight) => ["performance", "context"].includes(insight.kind));
  const growth = memo.insights.filter((insight) => insight.kind === "growth");
  const credit = memo.insights.filter((insight) => ["credit", "risk"].includes(insight.kind));
  const datedPublicEvidence = memo.sources.filter((source) => ["public-news", "company-release"].includes(source.kind) && source.access === "public" && source.publishedAt).slice(0, 2);
  const industrySource = memo.industry && memo.sources.find((source) => source.id === memo.industry?.sourceId);
  const citedIds = new Set([
    ...slots.flatMap(({ metric }) => metric ? factSources(metric.inputFactIds, memo.facts) : []),
    ...factSources(annual.flatMap((point) => point.revenueFactIds), memo.facts),
    ...marginSourceIds,
    ...(maturity ? [maturity.sourceId] : []),
    ...ratings.map((rating) => rating.sourceId),
    ...(trends ? [trends.sourceId] : []),
    ...memo.insights.flatMap((insight) => insight.evidenceIds),
    ...datedPublicEvidence.map((source) => source.id),
    ...(industrySource ? [industrySource.id] : []),
  ]);
  const citedSources = memo.sources.filter((source) => citedIds.has(source.id));

  return <div className="dossier-preview" id="print-memo">
    <div className="dossier-preview-note"><span className="preview-pip" /> {demo ? "Saved FY2026 example" : "Two-page layout preview"} <span>·</span> {demo ? "Sample preview · no live data retrieval" : "Available figures are sourced; unfinished sections show N/A"}</div>
    <PageFrame memo={memo} page={1} title="Financial position" demo={demo}>
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
        <section className="dossier-panel maturity-panel" aria-label="Debt maturity schedule"><div className="dossier-panel-head"><div><span>03 / DEBT PROFILE</span><h3>Debt maturities</h3></div><span className="panel-period">{maturityBuckets.length ? maturity?.asOf : "N/A"}</span></div>
          {maturityBuckets.length ? <><div className="dossier-maturity-bars">{maturityBuckets.map((bucket, index) => {
            const total = (bucket.senior ?? 0) + (bucket.junior ?? 0) + (bucket.unclassified ?? 0);
            const height = total === 0 ? 0 : Math.max(4, total / maturityMaximum * 74);
            return <div className="dossier-maturity-bucket" key={`${bucket.label}-${index}`} title={`${bucket.label}: ${money(total * 1e6)} scheduled principal`}><b>{money(total * 1e6)}</b><div className="dossier-maturity-stack" style={{ height: `${height}px` }}>
              {bucket.unclassified !== null && bucket.unclassified > 0 && <i className="maturity-unclassified" style={{ height: `${bucket.unclassified / total * 100}%` }} />}
              {bucket.junior !== null && bucket.junior > 0 && <i className="maturity-junior" style={{ height: `${bucket.junior / total * 100}%` }} />}
              {bucket.senior !== null && bucket.senior > 0 && <i className="maturity-senior" style={{ height: `${bucket.senior / total * 100}%` }} />}
            </div><span>{bucket.label}</span></div>;
          })}</div><div className="dossier-maturity-legend"><span><i className="maturity-senior" /> Senior</span><span><i className="maturity-junior" /> Junior</span><span><i className="maturity-unclassified" /> Unclassified</span></div><p className="dossier-panel-note">{maturity!.basis} · USD millions <Citation ids={[maturity!.sourceId]} sources={memo.sources} />{maturity!.note && <span className="dossier-maturity-note">{maturity!.note}</span>}</p></> : <p className="dossier-panel-note dossier-empty-panel"><b>N/A</b> · {memo.debtMaturities ? "Imported maturity schedule awaits analyst review or has no usable buckets." : "No reviewed, source-linked debt maturity schedule has been imported."}</p>}
        </section>
      </div>
      <section className="dossier-panel trends-panel" aria-label="Google Trends search interest"><div><span>04 / EXTERNAL SIGNAL</span><h3>Google search interest</h3>{trends && usableTrendPoints.length >= 2 ? <p>Query “{trends.query}” · {trends.geography} · {trends.periodStart} to {trends.periodEnd} · retrieved {trends.retrievedAt}. Relative search interest, indexed 0–100. <Citation ids={[trends.sourceId]} sources={memo.sources} /></p> : <p><b>N/A</b> · {memo.googleTrends ? "Imported Google Trends data awaits review or lacks two usable observations." : "No reviewed Google Trends export has been imported."}</p>}</div>
        {trends && usableTrendPoints.length >= 2 && <div className="dossier-trends-chart"><svg viewBox="0 0 160 50" role="img" aria-label={`Google Trends search interest for ${trends.query}, ${trends.periodStart} to ${trends.periodEnd}`}><path d="M4 45H156M4 25H156M4 5H156" className="trend-grid" />{trendSegments.map((segment, index) => segment.length > 1 ? <polyline points={segment.join(" ")} className="trend-data" key={index} /> : <circle cx={segment[0]?.split(",")[0]} cy={segment[0]?.split(",")[1]} r="2" className="trend-point" key={index} />)}</svg><div><span>{trends.periodStart}</span><span>{trends.periodEnd}</span></div></div>}
      </section>
      <div className="dossier-rating-row"><span>CREDIT RATING</span>{ratings.length ? ratings.slice(0, 2).map((rating, index) => <p key={`${rating.agency}-${rating.scope}-${index}`}><strong>{rating.agency} {rating.rating}</strong> · {rating.scope} · {rating.asOf} <Citation ids={[rating.sourceId]} sources={memo.sources} /></p>) : <p><strong>N/A</strong> · No dated, reviewed issuer or debt rating has been added.</p>}</div>
      <p className="dossier-method">EBITDA and leverage measures use the stated source and formula; estimates are not covenant calculations. Missing values are not inferred. Financial figures retain their filing trail.</p>
    </PageFrame>
    <PageFrame memo={memo} page={2} title="Business perspective" demo={demo}>
      <div className="dossier-section-title"><span>05 / ANALYST READOUT</span><p>Business drivers · credit questions · source trail</p></div>
      <div className="dossier-lede"><span>THE READOUT</span><p>What changed at {memo.company.name}, and what does the evidence suggest a banker should examine next?</p></div>
      <div className="dossier-narrative-grid">
        <section className="dossier-narrative-section"><span>01</span><h3>Performance &amp; drivers</h3>{performance.length ? performance.map((insight) => <p key={insight.id}>{insight.text} <Citation ids={insight.evidenceIds} sources={memo.sources} />{!insight.reviewed && <small className="dossier-draft-tag">Draft · analyst review pending</small>}</p>) : <p>N/A · A source-backed explanation of revenue changes is pending.</p>}</section>
        <section className="dossier-narrative-section"><span>02</span><h3>Credit view &amp; risks</h3>{credit.length ? credit.map((insight) => <p key={insight.id}>{insight.text} <Citation ids={insight.evidenceIds} sources={memo.sources} />{!insight.reviewed && <small className="dossier-draft-tag">Draft · analyst review pending</small>}</p>) : <p>N/A · Source-backed credit and risk observations are pending.</p>}</section>
      </div>
      <div className="dossier-followup"><div><span>OPPORTUNITIES / FOLLOW-UP</span><h3>Growth signals to test</h3></div><div>{growth.length ? growth.map((insight) => <p key={insight.id}>{insight.text} <Citation ids={insight.evidenceIds} sources={memo.sources} />{!insight.reviewed && <small className="dossier-draft-tag">Draft · analyst review pending</small>}</p>) : <p>N/A · No source-backed opportunity or growth signal has been reviewed. Test commercial upside separately before drawing a conclusion.</p>}</div></div>
      <div className="dossier-context-grid"><section><span>INDUSTRY CONTEXT</span>{memo.industry && industrySource && (industrySource.access === "licensed" || industrySource.reviewed === true) ? <p>{excerpt(memo.industry.summary)} <Citation ids={[industrySource.id]} sources={memo.sources} /><small>Summary excerpt · {industrySource.access === "licensed" ? "licensed reference, local use only" : "public reference"}{memo.industry.publicationDate ? ` · ${memo.industry.publicationDate}` : ""}</small></p> : <p>N/A · {memo.industry ? "Public industry source awaits analyst review." : "No attributable industry analysis has been added."}</p>}</section><section><span>DATED PUBLIC EVIDENCE</span>{datedPublicEvidence.length ? datedPublicEvidence.map((source) => <p key={source.id}>{source.publishedAt} · {source.title} <Citation ids={[source.id]} sources={memo.sources} />{source.reviewed !== true && <small>Source review pending</small>}</p>) : <p>N/A · No dated public news or company release has been added.</p>}</section></div>
      <section className="dossier-source-section"><div className="dossier-section-title"><span>06 / SOURCE REGISTER</span><p>Every numbered reference used in this draft</p></div><ol>{citedSources.map((source) => <li key={source.id}><span>[{memo.sources.indexOf(source) + 1}]</span><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{source.publishedAt ?? "Date N/A"} · {source.access}</small></li>)}</ol>{!citedSources.length && <p className="dossier-empty-data">N/A · No valid source references are attached.</p>}</section>
    </PageFrame>
  </div>;
}
