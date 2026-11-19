"use client";

import type { EvidenceClaim, Memo, Metric, Source } from "@/lib/types";

function amount(value: number) {
  if (Math.abs(value) >= 1e9) return "$" + (value / 1e9).toFixed(2) + "B";
  if (Math.abs(value) >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
  return "$" + value.toLocaleString();
}

function metricValue(metric: Metric) {
  if (metric.value === null) return "";
  if (metric.unit === "USD") return amount(metric.value);
  if (metric.unit === "percent") return metric.value.toFixed(1) + "%";
  if (metric.unit === "days") return metric.value.toFixed(1) + " days";
  return metric.value.toFixed(2) + "×";
}

function Citations({ ids, sources }: { ids: string[]; sources: Source[] }) {
  const unique = [...new Set(ids)];
  return <span className="dossier-citations">{unique.map((id) => {
    const index = sources.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const source = sources[index];
    return <a key={id} href={source.url} target="_blank" rel="noreferrer"
      title={source.title} aria-label={"Source " + (index + 1) + ": " + source.title}>[{index + 1}]</a>;
  })}</span>;
}

function Claim({ claim, sources }: { claim?: EvidenceClaim; sources: Source[] }) {
  return claim ? <p>{claim.text} <Citations ids={claim.sourceIds} sources={sources} /></p> : null;
}

function Page({ memo, page, title, children }: { memo: Memo; page: 1 | 2; title: string; children: React.ReactNode }) {
  return <article className="dossier-page private-page" aria-label={"Private memo page " + page + ": " + title}>
    <header className="dossier-head">
      <div className="dossier-topline"><span>FIELDNOTE <i /> COMPANY RESEARCH</span><span>DS3 CONSULTING / PRIVATE-COMPANY DRAFT</span></div>
      <div className="dossier-head-main"><div><span className="dossier-kicker">PRIVATE COMPANY / 0{page}</span>
        <h2>{title}</h2><p>{memo.company.name} <span>·</span> {memo.periodLabel}</p></div>
        <div className="dossier-head-side"><strong>{page}<span>/02</span></strong><small>{memo.reviewStatus === "reviewed" ? "REVIEWED" : "DRAFT · ANALYST REVIEW"}</small></div></div>
    </header>
    <div className="dossier-page-body">{children}</div>
    <footer className="dossier-foot"><span>Evidence snapshot · review every claim before use</span><span>PRIVATE / 0{page}</span></footer>
  </article>;
}

export default function PrivateMemoView({ memo }: { memo: Memo }) {
  const profile = memo.privateProfile;
  if (!profile) return null;
  const sources = memo.sources;
  const factSource = new Map(memo.facts.map((fact) => [fact.id, fact.sourceId]));
  const metricSources = (metric: Metric) => [...new Set(metric.inputFactIds.map((id) => factSource.get(id)).filter((id): id is string => Boolean(id)))];
  const knownMetrics = memo.metrics.filter((metric) => metric.value !== null);
  const publicInsights = memo.insights.filter((insight) => insight.evidenceIds.length);
  const funding = profile.fundingRounds;
  const maxFunding = Math.max(1, ...funding.map((round) => round.amountUsd ?? 0));
  const used = new Set([
    ...knownMetrics.flatMap(metricSources), ...publicInsights.flatMap((item) => item.evidenceIds),
    ...[profile.description, profile.industry, profile.valueProposition, profile.businessDetails,
      ...profile.founders, ...profile.investors, ...profile.competitors]
      .filter((item): item is EvidenceClaim => Boolean(item)).flatMap((item) => item.sourceIds),
    ...funding.flatMap((round) => round.sourceIds),
  ]);
  const cited = sources.filter((source) => used.has(source.id));
  return <div className="dossier-preview" id="print-memo">
    <div className="dossier-preview-note"><span className="preview-pip" /> Private-company two-page preview <span>·</span> Only supplied, cited information appears</div>
    <Page memo={memo} page={1} title="Company &amp; capital">
      <div className="private-kicker">01 / BUSINESS SNAPSHOT</div>
      <div className="private-lede"><Claim claim={profile.description} sources={sources} />
        {profile.industry && <div><b>PRIMARY MARKET</b><Claim claim={profile.industry} sources={sources} /></div>}</div>
      {(profile.valueProposition || profile.businessDetails) && <div className="private-two-up">
        {profile.valueProposition && <section><h3>Value proposition</h3><Claim claim={profile.valueProposition} sources={sources} /></section>}
        {profile.businessDetails && <section><h3>How it operates</h3><Claim claim={profile.businessDetails} sources={sources} /></section>}
      </div>}
      {knownMetrics.length > 0 && <section className="private-section"><div className="dossier-section-title"><span>02 / AVAILABLE FINANCIALS</span><p>Source-reported amounts and derived screening ratios</p></div>
        <div className="private-metric-grid">{knownMetrics.map((metric) => <div className="private-metric" key={metric.id}>
          <span>{metric.label}</span><strong>{metricValue(metric)}</strong><small>{metric.period} · {metric.status}</small>
          <Citations ids={metricSources(metric)} sources={sources} /></div>)}</div>
        {memo.annualTrends.filter((point) => point.revenue !== null).length > 1 && <div className="private-financial-trend"><b>REVENUE HISTORY</b>
          {memo.annualTrends.filter((point) => point.revenue !== null).map((point) => <span key={point.end}>{point.period}: {amount(point.revenue!)} <Citations ids={point.revenueFactIds.map((id) => factSource.get(id) ?? "")} sources={sources} /></span>)}</div>}
      </section>}
      {funding.length > 0 && <section className="private-section"><div className="dossier-section-title"><span>03 / CAPITAL RAISES</span><p>Disclosed deals only</p></div>
        <div className="private-rounds">{funding.map((round, index) => <div className="private-round" key={index}>
          <div><b>{round.stage}</b><small>{round.announcedAt ?? "Date not supplied"}</small></div>
          {round.amountUsd !== undefined && <div className="private-round-bar"><i style={{ width: Math.max(8, round.amountUsd / maxFunding * 100) + "%" }} /></div>}
          <strong>{round.amountUsd !== undefined ? amount(round.amountUsd) : "Amount undisclosed"}</strong>
          <Citations ids={round.sourceIds} sources={sources} />
          {round.investors.length > 0 && <p>Named participants: {round.investors.join(", ")}</p>}
        </div>)}</div>
      </section>}
      <p className="private-caveat">Private-company information may be incomplete. Undocumented financing, debt, and operating measures are omitted.</p>
    </Page>
    <Page memo={memo} page={2} title="Evidence &amp; credit questions">
      <div className="private-two-up private-context">
        {profile.founders.length > 0 && <section><h3>Founder background</h3>{profile.founders.map((item, index) => <Claim key={index} claim={item} sources={sources} />)}</section>}
        {profile.investors.length > 0 && <section><h3>Investors</h3>{profile.investors.map((item, index) => <Claim key={index} claim={item} sources={sources} />)}</section>}
        {profile.competitors.length > 0 && <section><h3>Competitors</h3>{profile.competitors.map((item, index) => <Claim key={index} claim={item} sources={sources} />)}</section>}
      </div>
      {publicInsights.length > 0 && <section className="private-section"><div className="dossier-section-title"><span>04 / ANALYST READOUT</span><p>Source-linked draft observations</p></div>
        <div className="private-insights">{publicInsights.map((insight) => <p key={insight.id}><b>{insight.kind.toUpperCase()}</b> {insight.text} <Citations ids={insight.evidenceIds} sources={sources} />{!insight.reviewed && <small>Draft · review pending</small>}</p>)}</div>
      </section>}
      <section className="private-section"><div className="dossier-section-title"><span>05 / CREDIT QUESTIONS</span><p>Questions for diligence, not conclusions</p></div>
        <div className="private-questions"><p>Can the company document recurring revenue, cash generation, and debt obligations?</p>
          <p>What did each financing round fund, and what is the current runway?</p>
          <p>How do customer concentration and competitive position affect repayment capacity?</p></div>
      </section>
      <section className="dossier-source-section private-source-section"><div className="dossier-section-title"><span>06 / SOURCE REGISTER</span><p>All cited materials require analyst review</p></div>
        <ol>{cited.map((source) => <li key={source.id}><span>[{sources.indexOf(source) + 1}]</span>
          <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
          <small>{source.publishedAt ?? "Undated"} · {source.access}</small></li>)}</ol>
      </section>
    </Page>
  </div>;
}
