"use client";

import { useMemo, useState } from "react";
import { pilotMemo } from "@/lib/pilots";
import MemoView from "./MemoView";

const companies = [
  { ticker: "WMT", name: "Walmart Inc.", sector: "Retail & omnichannel", initials: "W" },
  { ticker: "MSFT", name: "Microsoft Corporation", sector: "Technology & cloud", initials: "M" },
] as const;
type Ticker = typeof companies[number]["ticker"];

export default function DemoWorkbench() {
  const [selectedTicker, setSelectedTicker] = useState<Ticker>("WMT");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const memo = useMemo(() => pilotMemo(selectedTicker), [selectedTicker]);
  const company = companies.find((item) => item.ticker === selectedTicker)!;
  const matches = companies.filter((item) => `${item.ticker} ${item.name}`.toLowerCase().includes(query.trim().toLowerCase()));

  function openCompany(ticker: Ticker) {
    setSelectedTicker(ticker);
    setQuery("");
    setSearchOpen(false);
    setActiveResult(0);
    setError(null);
    setAnnouncement(`${companies.find((item) => item.ticker === ticker)!.name} sample memo loaded.`);
    if (window.matchMedia("(max-width: 850px)").matches) {
      document.getElementById("memo-preview")?.scrollIntoView({ block: "start" });
    }
  }

  async function printMemo() {
    setError(null);
    await document.fonts.ready;
    const pages = Array.from(document.querySelectorAll<HTMLElement>("#print-memo .dossier-page"));
    if (pages.length !== 2) {
      setError("Open a two-page sample memo before printing.");
      return;
    }
    const measure = document.createElement("div");
    measure.className = "dossier-print-measure";
    measure.setAttribute("aria-hidden", "true");
    pages.forEach((page) => measure.appendChild(page.cloneNode(true)));
    document.body.appendChild(measure);
    let overflowing = false;
    try {
      overflowing = Array.from(measure.querySelectorAll<HTMLElement>(".dossier-page")).some((page) => {
        const footer = page.querySelector<HTMLElement>(".dossier-foot");
        return page.scrollHeight > page.clientHeight + 2 ||
          (footer !== null && footer.getBoundingClientRect().bottom > page.getBoundingClientRect().bottom - 4);
      });
    } finally {
      measure.remove();
    }
    if (overflowing) {
      setError("The sample exceeds two letter pages at the current print layout. Please use the browser preview to review it.");
      return;
    }
    window.print();
  }

  return <div className="app-shell demo-shell">
    <a className="skip-link" href="#memo-preview">Skip to memo</a>
    <aside className="sidebar" aria-label="Demo company selection">
      <div className="jpm-brand"><img src="/brand/jpmorgan-white.png" alt="J.P. Morgan" width="186" height="56" /><span>COMPANY RESEARCH</span></div>
      <div className="sidebar-rule" />
      <div className="sidebar-section-label">RESEARCH WORKSPACE <span>DEMO / 01</span></div>
      <div className="side-intro"><h2>Understand the company.<br /><em>Focus on what matters.</em></h2><p>A clearer starting point for understanding a business and its financial position.</p></div>
      <section className="side-block">
        <div className="side-block-heading"><span>01</span><h3>Explore a company</h3></div>
        <form className="demo-search" onSubmit={(event) => { event.preventDefault(); if (matches.length) openCompany(matches[activeResult % matches.length].ticker); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchOpen(false); }}>
          <label htmlFor="company-search">COMPANY NAME OR TICKER</label>
          <div className="ticker-box"><input id="company-search" role="combobox" aria-autocomplete="list" aria-expanded={searchOpen && matches.length > 0} aria-controls="demo-company-results" aria-activedescendant={searchOpen && matches.length ? `demo-result-${matches[activeResult % matches.length].ticker}` : undefined} aria-describedby="demo-search-help" autoComplete="off" placeholder="Walmart or MSFT" value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setActiveResult(0); }} onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setSearchOpen(true);
              if (matches.length) setActiveResult((index) => (index + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
            }
            if (event.key === "Escape") setSearchOpen(false);
          }} /><button type="submit" aria-label="Open matching sample memo" disabled={!matches.length}>↗</button></div>
          {searchOpen && matches.length > 0 && <div className="suggestions" id="demo-company-results" role="listbox" aria-label="Sample company results">{matches.map((item, index) => <button type="button" role="option" id={`demo-result-${item.ticker}`} aria-selected={index === activeResult % matches.length} key={item.ticker} onClick={() => openCompany(item.ticker)}><b>{item.ticker}</b><span>{item.name}</span></button>)}</div>}
          {searchOpen && !matches.length && <p className="demo-search-empty" role="status">This demo includes Walmart and Microsoft. Try WMT or MSFT.</p>}
          <p className="side-hint demo-search-help" id="demo-search-help">Search the two saved examples below.</p>
        </form>
        <div className="demo-company-list">{companies.map((item) => <button type="button" key={item.ticker} aria-pressed={selectedTicker === item.ticker} onClick={() => openCompany(item.ticker)}><span className="demo-company-symbol" aria-hidden="true">{item.initials}</span><span><strong>{item.name.replace(" Inc.", "").replace(" Corporation", "")}</strong><small>{item.ticker} / {item.sector}</small></span><span className="demo-company-arrow" aria-hidden="true">{selectedTicker === item.ticker ? "✓" : "↗"}</span></button>)}</div>
      </section>
      <nav className="side-block demo-page-nav" aria-label="Memo pages"><div className="side-block-heading"><span>02</span><h3>Inside the memo</h3></div><a href="#financial-position"><span>01</span> Financial position <b>↓</b></a><a href="#business-perspective"><span>02</span> Business perspective <b>↓</b></a></nav>
      <div className="demo-side-note"><span className="tiny-label">FRONTEND DEMO</span><p>Explore saved company memos and the proposed research experience. Live data connections and AI research are planned.</p></div>
      <div className="sidebar-foot">DS3 Consulting <span>·</span> Project demo</div>
    </aside>
    <main className="main-panel" id="memo-preview" tabIndex={-1}>
      <header className="topbar"><div><span className="eyebrow">COMPANY RESEARCH</span><h1>Research workbench</h1></div><div className="topbar-actions"><span className="demo-badge">FRONTEND DEMO</span><button className="outline-button" onClick={() => void printMemo()}>Print / Save as PDF ↗</button></div></header>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {error && <div className="alert error" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss print message">×</button></div>}
      <div className="workspace-grid"><div className="memo-column">
        <div className="canvas-toolbar"><div><span className="eyebrow">THE DELIVERABLE / SAMPLE PREVIEW</span><h2>Two-page memo</h2></div><span className="canvas-stage">01 FINANCIALS &nbsp; / &nbsp; 02 CONTEXT</span></div>
        <MemoView memo={memo} demo />
      </div><aside className="right-rail" aria-label="Sample context and sources">
        <section className="rail-card demo-profile"><span className="eyebrow">SELECTED COMPANY</span><span className="demo-profile-ticker">{selectedTicker}</span><h3>{memo.company.name}</h3><p>{company.sector}</p><div className="rail-line"><span>PERIOD</span><b>FY 2026</b></div><div className="rail-line"><span>MEMO</span><b>2 PAGES</b></div><div className="rail-line"><span>DATA</span><b>SAVED EXAMPLE</b></div></section>
        <section className="rail-card"><span className="eyebrow">SOURCE REGISTER</span><h3>Trace the research.</h3><p>Open the original sources behind this saved example.</p><div className="source-register">{memo.sources.map((source, index) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span>[{index + 1}]</span><p>{source.title}<small>{source.publishedAt}</small></p><b aria-hidden="true">↗</b></a>)}</div></section>
        <section className="rail-card demo-scope"><span className="eyebrow">ABOUT THIS PREVIEW</span><h3>The memo comes first.</h3><p>The examples show the proposed layout, financial visuals, and business commentary. Missing evidence stays N/A.</p><p>Sample selection and printing work locally. Search across other companies, new research, and follow-up Q&amp;A will come with the data integrations.</p></section>
      </aside></div>
    </main>
  </div>;
}
