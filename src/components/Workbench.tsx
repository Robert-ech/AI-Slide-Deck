"use client";

import { useCallback, useEffect, useState } from "react";
import MemoView from "./MemoView";
import type { Insight, Memo, PublicSourceInput, Source } from "@/lib/types";

type Saved = Pick<Memo, "id" | "generatedAt" | "company" | "reviewStatus">;
type NewsCandidate = { title: string; url: string; publishedAt: string; domain: string };

const blankSource = (): PublicSourceInput => ({ title: "", url: "", publishedAt: "", note: "", kind: "public-news" });

export default function Workbench() {
  const [ticker, setTicker] = useState("WMT");
  const [selectedTicker, setSelectedTicker] = useState<string | null>("WMT");
  const [companyName, setCompanyName] = useState("Walmart");
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([]);
  const [sources, setSources] = useState<PublicSourceInput[]>([]);
  const [news, setNews] = useState<NewsCandidate[]>([]);
  const [memo, setMemo] = useState<Memo | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reportCode, setReportCode] = useState("");
  const [factsFile, setFactsFile] = useState<File | null>(null);
  const [submissionsFile, setSubmissionsFile] = useState<File | null>(null);

  const refreshSaved = useCallback(async () => {
    const response = await fetch("/api/memos");
    if (response.ok) setSaved((await response.json()).memos);
  }, []);
  useEffect(() => { void refreshSaved(); }, [refreshSaved]);
  useEffect(() => {
    if (ticker.trim().length < 1) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/companies?q=${encodeURIComponent(ticker)}`);
      if (response.ok) setSuggestions((await response.json()).companies);
    }, 300);
    return () => clearTimeout(timer);
  }, [ticker]);

  async function generate() {
    const resolvedTicker = selectedTicker ?? (/^[A-Za-z.-]{1,8}$/.test(ticker.trim()) ? ticker.trim().toUpperCase() : null);
    if (!resolvedTicker) { setError("Select a company from the search results before generating a memo."); return; }
    setError(null); setNotice(null); setBusy("Building memo");
    try {
      const usableSources = sources.filter((source) => source.title || source.url || source.note);
      const response = await fetch("/api/memos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: resolvedTicker, publicSources: usableSources }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Memo generation failed.");
      setMemo(result.memo); setNotice("Draft memo created. Check every figure and source before marking it reviewed.");
      await refreshSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Memo generation failed."); }
    finally { setBusy(null); }
  }

  async function openMemo(id: string) {
    setBusy("Opening memo"); setError(null);
    try {
      const response = await fetch(`/api/memos/${id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open memo.");
      setMemo(result.memo); setReportCode(result.memo.industry?.reportCode || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open memo."); }
    finally { setBusy(null); }
  }

  async function openPilot(pilot: "WMT" | "MSFT") {
    setBusy("Opening design reference"); setError(null);
    try {
      const response = await fetch(`/api/pilots/${pilot}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open pilot.");
      setMemo(result.memo); setTicker(pilot); setSelectedTicker(pilot); setCompanyName(result.memo.company.name);
      setNotice("This is a manually verified FY2026 design reference. Generate a new memo for the latest filings.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open pilot."); }
    finally { setBusy(null); }
  }

  async function importSecFiles() {
    if (!factsFile || !submissionsFile) { setError("Choose both SEC JSON files first."); return; }
    setBusy("Importing SEC files"); setError(null);
    try {
      const form = new FormData();
      form.append("ticker", selectedTicker ?? ticker);
      form.append("facts", factsFile);
      form.append("submissions", submissionsFile);
      const response = await fetch("/api/import/sec", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "SEC import failed.");
      setNotice(`Official SEC JSON imported for ${result.ticker}. You can now generate a live memo from the local files.`);
      setFactsFile(null); setSubmissionsFile(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "SEC import failed."); }
    finally { setBusy(null); }
  }

  async function findNews() {
    setBusy("Finding articles"); setError(null);
    try {
      const response = await fetch(`/api/news?company=${encodeURIComponent(companyName)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "News search failed.");
      setNews(result.candidates);
      if (!result.candidates.length) setNotice("No recent article candidates were found. Add a public source manually.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "News search failed."); }
    finally { setBusy(null); }
  }

  async function saveInsights(next: Insight[], status?: "draft" | "reviewed") {
    if (!memo) return;
    setBusy("Saving review"); setError(null);
    try {
      const response = await fetch(`/api/memos/${memo.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insights: next, ...(status ? { reviewStatus: status } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Review save failed.");
      setMemo(result.memo); setNotice(status === "reviewed" ? "Memo marked reviewed." : "Draft review saved.");
      await refreshSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review save failed."); }
    finally { setBusy(null); }
  }

  async function addIndustry() {
    if (!memo) return;
    setBusy("Loading industry context"); setError(null);
    try {
      const response = await fetch(`/api/memos/${memo.id}/industry`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportCode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "IBISWorld lookup failed.");
      setMemo(result.memo); setNotice("Industry context added locally. It was not sent to OpenAI.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "IBISWorld lookup failed."); }
    finally { setBusy(null); }
  }

  async function printMemo() {
    const pages = Array.from(document.querySelectorAll<HTMLElement>("#print-memo .dossier-page"));
    if (pages.length !== 2) {
      setError("The memo preview must contain exactly two pages before printing.");
      return;
    }
    await document.fonts.ready;
    const measure = document.createElement("div");
    measure.className = "dossier-print-measure";
    measure.setAttribute("aria-hidden", "true");
    pages.forEach((page) => measure.appendChild(page.cloneNode(true)));
    document.body.appendChild(measure);
    const overflowing = Array.from(measure.querySelectorAll<HTMLElement>(".dossier-page")).some((page) => {
      const footer = page.querySelector<HTMLElement>(".dossier-foot");
      return page.scrollHeight > page.clientHeight + 2 ||
        (footer !== null && footer.getBoundingClientRect().bottom > page.getBoundingClientRect().bottom - 4);
    });
    measure.remove();
    if (overflowing) {
      setError("This draft exceeds two letter pages. Shorten the narrative or source register, save the draft, then try printing again.");
      return;
    }
    setError(null);
    window.print();
  }

  function updateSource(index: number, field: keyof PublicSourceInput, value: string) {
    setSources((current) => current.map((source, itemIndex) => itemIndex === index ? { ...source, [field]: value } : source));
  }
  function sourceLabel(source: Source): string { return `${source.title}${source.publishedAt ? ` · ${source.publishedAt}` : ""}`; }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">F<span>·</span></span><div><strong>FIELDNOTE</strong><small>CREDIT RESEARCH STUDIO</small></div></div>
      <div className="sidebar-rule" />
      <div className="sidebar-section-label">WORKSPACE <span>01 / LOCAL</span></div>
      <div className="side-intro"><h2>Understand the company,<br /><em>then the numbers.</em></h2><p>A source-backed first pass for public-company credit research. The two-page format is under review.</p></div>

      <div className="side-block"><div className="side-block-heading"><span>01</span><h3>Choose a company</h3></div>
        <label htmlFor="ticker">COMPANY NAME OR TICKER</label><div className="ticker-box"><input id="ticker" value={ticker} onChange={(event) => { setTicker(event.target.value); setSelectedTicker(null); }} placeholder="WMT or Walmart" maxLength={60} autoComplete="off" /><span>↗</span></div>
        {suggestions.length > 0 && <div className="suggestions">{suggestions.slice(0, 5).map((company) => <button key={company.ticker} onClick={() => { setTicker(company.ticker); setSelectedTicker(company.ticker); setCompanyName(company.name); setSuggestions([]); }}><b>{company.ticker}</b><span>{company.name}</span></button>)}</div>}
        <div className="pilot-picks"><span>PILOT COMPANIES</span><button onClick={() => { setTicker("WMT"); setSelectedTicker("WMT"); setCompanyName("Walmart"); }}>WMT</button><button onClick={() => { setTicker("MSFT"); setSelectedTicker("MSFT"); setCompanyName("Microsoft"); }}>MSFT</button></div>
        <div className="pilot-preview"><button onClick={() => openPilot("WMT")}>Preview Walmart memo ↗</button><button onClick={() => openPilot("MSFT")}>Preview Microsoft memo ↗</button></div>
      </div>

      {(selectedTicker === "WMT" || selectedTicker === "MSFT") && <details className="import-box"><summary>SEC access blocked? Import JSON locally</summary><p>Download the official companyfacts and submissions JSON for the selected pilot in your browser, then add both files here. They stay on this computer.</p><div className="import-links"><a href={`https://data.sec.gov/api/xbrl/companyfacts/CIK${selectedTicker === "MSFT" ? "0000789019" : "0000104169"}.json`} target="_blank" rel="noreferrer">Company facts ↗</a><a href={`https://data.sec.gov/submissions/CIK${selectedTicker === "MSFT" ? "0000789019" : "0000104169"}.json`} target="_blank" rel="noreferrer">Submissions ↗</a></div><label>COMPANY FACTS JSON<input type="file" accept=".json,application/json" onChange={(event) => setFactsFile(event.target.files?.[0] ?? null)} /></label><label>SUBMISSIONS JSON<input type="file" accept=".json,application/json" onChange={(event) => setSubmissionsFile(event.target.files?.[0] ?? null)} /></label><button onClick={importSecFiles} disabled={Boolean(busy) || !factsFile || !submissionsFile}>Import for {selectedTicker}</button></details>}

      <div className="side-block"><div className="side-block-heading"><span>02</span><h3>Add public context</h3></div>
        <p className="side-hint">Article titles are candidates. Add a short verified note before using one in commentary.</p>
        <div className="news-search"><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} aria-label="Company name for news search" /><button onClick={findNews} disabled={Boolean(busy)}>Find news</button></div>
        {news.length > 0 && <div className="news-candidates"><span className="tiny-label">RECENT CANDIDATES</span>{news.slice(0, 6).map((candidate) => <button key={candidate.url} onClick={() => { setSources((current) => [...current, { title: candidate.title, url: candidate.url, publishedAt: candidate.publishedAt, note: "", kind: "public-news" }]); setNews([]); }}><b>{candidate.title}</b><small>{candidate.domain} · Add source + note</small></button>)}</div>}
        {sources.map((source, index) => <div className="source-editor" key={index}>
          <div className="source-editor-title"><span>SOURCE {index + 1}</span><button onClick={() => setSources((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove source">×</button></div>
          <input placeholder="Article title" value={source.title} onChange={(event) => updateSource(index, "title", event.target.value)} />
          <input placeholder="https://…" value={source.url} onChange={(event) => updateSource(index, "url", event.target.value)} />
          <textarea placeholder="Verified fact or event from this source" value={source.note} onChange={(event) => updateSource(index, "note", event.target.value)} rows={3} />
        </div>)}
        <button className="text-button" onClick={() => setSources((current) => [...current, blankSource()])}>+ Add source manually</button>
      </div>

      <button className="generate-button" onClick={generate} disabled={Boolean(busy)}><span>{busy ?? "Generate draft memo"}</span><span>↗</span></button>
      <div className="sidebar-foot"><span className="local-dot" /> Local workspace <span>·</span> Single analyst</div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><div><span className="eyebrow">DS3 / CREDIT INTELLIGENCE</span><h1>Research workbench</h1></div><div className="topbar-actions"><span className="topbar-date">PRIVATE PILOT</span>{memo && <button className="outline-button" onClick={() => void printMemo()}>Print / Save as PDF ↗</button>}</div></header>
      {error && <div className="alert error"><b>Action needed</b><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
      {notice && <div className="alert notice"><span>{notice}</span><button onClick={() => setNotice(null)}>×</button></div>}
      <div className="workspace-grid"><div className="memo-column">
        <div className="canvas-toolbar"><div><span className="eyebrow">THE DELIVERABLE / DESIGN PREVIEW</span><h2>Two-page memo</h2></div><span className="canvas-stage">01 FINANCIALS &nbsp; / &nbsp; 02 CONTEXT</span></div>
        {memo ? <><MemoView memo={memo} />{memo.warnings.length > 0 && <div className="warning-panel"><b>Data and review notes</b>{memo.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}</> : <div className="empty-memo"><div className="empty-sheet"><div className="empty-topline" /><div className="empty-title">The best memo begins<br /><em>with the right question.</em></div><div className="empty-divider" /><div className="empty-grid"><span /><span /><span /><span /></div><p>Preview Walmart or Microsoft to review the two-page design, or generate a source-backed draft using available SEC data.</p></div><span className="empty-caption">TWO-PAGE FORMAT READY FOR REVIEW · NEW DATA SECTIONS SHOW N/A</span></div>}
        {memo && !memo.id.startsWith("pilot-") && <div className="review-panel"><div className="review-heading"><div><span className="eyebrow">ANALYST CONTROL</span><h2>Review the narrative</h2></div><span className={`review-badge ${memo.reviewStatus}`}>{memo.reviewStatus}</span></div><p>Check each claim against its cited source. Editing a line returns the memo to draft status.</p>
          {memo.insights.map((insight, index) => <div className="review-row" key={insight.id}><div className="review-row-header"><span>0{index + 1} / {insight.kind.toUpperCase()}</span><label><input type="checkbox" checked={insight.reviewed} onChange={(event) => setMemo((current) => current ? { ...current, insights: current.insights.map((item) => item.id === insight.id ? { ...item, reviewed: event.target.checked } : item), reviewStatus: "draft" } : null)} /> Verified</label></div><textarea value={insight.text} onChange={(event) => setMemo((current) => current ? { ...current, insights: current.insights.map((item) => item.id === insight.id ? { ...item, text: event.target.value, reviewed: false } : item), reviewStatus: "draft" } : null)} rows={3} /><small>Evidence: {insight.evidenceIds.map((id) => memo.sources.find((source) => source.id === id)?.title ?? id).join(" · ") || "Source review needed"}</small></div>)}
          <div className="review-actions"><button className="outline-button" onClick={() => saveInsights(memo.insights)} disabled={Boolean(busy)}>Save draft</button><button className="solid-button" onClick={() => saveInsights(memo.insights, "reviewed")} disabled={Boolean(busy) || memo.insights.some((insight) => !insight.reviewed)}>Mark reviewed</button></div>
        </div>}
      </div>

      <aside className="right-rail"><div className="rail-card rail-summary"><span className="eyebrow">METHOD / 01</span><h3>Evidence before opinion.</h3><p>Every number keeps its filing trail. Commentary stays in draft until you check the underlying sources.</p><div className="rail-line"><span>FILINGS</span><b>{memo ? memo.sources.filter((source) => source.kind === "filing").length : "—"}</b></div><div className="rail-line"><span>PUBLIC SOURCES</span><b>{memo ? memo.sources.filter((source) => source.access === "public" && source.kind !== "filing").length : "—"}</b></div><div className="rail-line"><span>AI MODE</span><b>{memo ? memo.generationMode === "openai" ? "DRAFTED" : "LOCAL" : "—"}</b></div></div>
        {memo && <div className="rail-card"><span className="eyebrow">SOURCE REGISTER</span><h3>Trace the memo</h3><div className="source-register">{memo.sources.filter((source) => source.access === "public").slice(0, 20).map((source, index) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span>[{memo.sources.indexOf(source) + 1}]</span><p>{sourceLabel(source)}</p><b>↗</b></a>)}</div></div>}
        {memo && !memo.id.startsWith("pilot-") && <div className="rail-card industry-card"><span className="eyebrow">LICENSED INDUSTRY CONTEXT</span><h3>IBISWorld</h3><p>Choose a report code from your licensed account. This section remains local and is excluded from AI prompts.</p><div className="industry-form"><input value={reportCode} onChange={(event) => setReportCode(event.target.value)} placeholder="Report code" aria-label="IBISWorld report code" /><button onClick={addIndustry} disabled={Boolean(busy) || !reportCode.trim()}>Load</button></div>{memo.industry && <small>Connected: {memo.industry.reportTitle}</small>}</div>}
        <div className="rail-card saved-card"><span className="eyebrow">LOCAL ARCHIVE</span><h3>Recent memos</h3>{saved.length ? saved.map((item) => <button key={item.id} onClick={() => openMemo(item.id)}><span><b>{item.company.ticker}</b><small>{new Date(item.generatedAt).toLocaleDateString()}</small></span><span>↗</span></button>) : <p>No memos yet. Generate the first pilot to begin.</p>}</div>
      </aside></div>
    </main>
  </div>;
}
