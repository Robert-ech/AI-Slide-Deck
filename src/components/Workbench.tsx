"use client";

import { useCallback, useEffect, useState } from "react";
import MemoView from "./MemoView";
import type { Insight, Memo, PublicSourceInput, Source } from "@/lib/types";

type Saved = Pick<Memo, "id" | "generatedAt" | "company" | "reviewStatus">;
type NewsCandidate = { title: string; url: string; publishedAt: string; domain: string };
type MaturityRow = { label: string; fiscalYear: string; senior: string; junior: string; unclassified: string };

const blankSource = (): PublicSourceInput => ({ title: "", url: "", publishedAt: "", note: "", kind: "public-news" });
const blankMaturityRow = (): MaturityRow => ({ label: "", fiscalYear: "", senior: "", junior: "", unclassified: "" });

function EvidenceSourceFields({ publicOnly = false }: { publicOnly?: boolean }) {
  return <fieldset className="evidence-source-fields"><legend>Traceable source</legend>
    <label>Title<input name="source-title" required minLength={3} maxLength={180} placeholder="Filing table or ratings page" /></label>
    <label>HTTPS URL<input name="source-url" type="url" required pattern="https://.*" placeholder="https://…" /></label>
    {!publicOnly && <label>Access<select name="source-access" defaultValue="public"><option value="public">Public</option><option value="licensed">Licensed · local use</option></select></label>}
    <label>Publication date, if shown<input name="source-date" type="date" max={new Date().toISOString().slice(0, 10)} /></label>
    <label>Source note<input name="source-note" maxLength={400} placeholder="Where the figure appears" /></label>
  </fieldset>;
}

function importedSource(form: FormData, publicOnly = false) {
  const publishedAt = String(form.get("source-date") ?? "");
  const note = String(form.get("source-note") ?? "").trim();
  return {
    title: String(form.get("source-title") ?? "").trim(),
    url: String(form.get("source-url") ?? "").trim(),
    access: publicOnly ? "public" as const : String(form.get("source-access") ?? "public") as "public" | "licensed",
    ...(publishedAt ? { publishedAt } : {}),
    ...(note ? { note } : {}),
  };
}

export default function Workbench() {
  const [ticker, setTicker] = useState("WMT");
  const [selectedTicker, setSelectedTicker] = useState<string | null>("WMT");
  const [companyName, setCompanyName] = useState("Walmart");
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
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
  const [maturityRows, setMaturityRows] = useState<MaturityRow[]>([blankMaturityRow()]);

  const refreshSaved = useCallback(async () => {
    const response = await fetch("/api/memos");
    if (response.ok) setSaved((await response.json()).memos);
  }, []);
  useEffect(() => { void refreshSaved(); }, [refreshSaved]);
  useEffect(() => {
    if (ticker.trim().length < 1) { setSuggestions([]); setActiveSuggestion(-1); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/companies?q=${encodeURIComponent(ticker)}`);
      if (response.ok) {
        const result = await response.json();
        if (cancelled) return;
        setSuggestions(result.companies);
        setActiveSuggestion(-1);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ticker]);

  function selectCompany(company: { ticker: string; name: string }) {
    setTicker(company.ticker); setSelectedTicker(company.ticker); setCompanyName(company.name);
    setSuggestions([]); setActiveSuggestion(-1);
  }

  async function generate() {
    const resolvedTicker = selectedTicker ?? (/^[A-Za-z.-]{1,8}$/.test(ticker.trim()) ? ticker.trim().toUpperCase() : null);
    if (!resolvedTicker) { setError("Select a company from the search results before generating a memo."); return; }
    setError(null); setNotice(null); setBusy("Building memo");
    try {
      const usableSources = sources.filter((source) => source.title || source.url || source.note);
      if (usableSources.length > 8) throw new Error("Use no more than eight public sources in one memo.");
      if (usableSources.some((source) => !source.title.trim() || !source.url.trim() || !source.note.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt ?? ""))) {
        throw new Error("Each public source needs a title, URL, publication date, and verified evidence note.");
      }
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

  async function reviewSource(sourceId: string, reviewed: boolean) {
    if (!memo) return;
    setBusy("Saving source review"); setError(null);
    try {
      const response = await fetch(`/api/memos/${memo.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceReviews: [{ id: sourceId, reviewed }] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Source review could not be saved.");
      setMemo(result.memo);
      setNotice(reviewed ? "Source marked reviewed. Confirm its cited claims before reviewing the memo." : "Source returned to pending review.");
      await refreshSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Source review could not be saved."); }
    finally { setBusy(null); }
  }

  async function importEvidence(kind: "maturities" | "ratings" | "trends", body: Record<string, unknown>): Promise<boolean> {
    if (!memo) return false;
    setBusy(`Importing ${kind}`); setError(null);
    try {
      const response = await fetch(`/api/memos/${memo.id}/${kind}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `${kind} import failed.`);
      setMemo(result.memo);
      setNotice(`${kind[0].toUpperCase()}${kind.slice(1)} imported. The memo remains a draft until its evidence is reviewed.`);
      await refreshSaved();
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : `${kind} import failed.`); return false; }
    finally { setBusy(null); }
  }

  async function importMaturities(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memo) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = (value: string) => value.trim() === "" ? null : Number(value);
    const buckets = maturityRows.map((row) => ({
      label: row.label.trim(), fiscalYear: row.fiscalYear.trim() === "" ? null : Number(row.fiscalYear),
      senior: amount(row.senior), junior: amount(row.junior), unclassified: amount(row.unclassified),
    }));
    if (buckets.some((bucket) => !bucket.label || bucket.senior === null && bucket.junior === null && bucket.unclassified === null)) {
      setError("Each maturity row needs a label and at least one reported amount. Leave an unknown split blank; enter 0 only when the source reports zero.");
      return;
    }
    const imported = await importEvidence("maturities", {
      ticker: memo.company.ticker, asOf: String(data.get("asOf") ?? ""), basis: String(data.get("basis") ?? ""),
      currency: "USD", scale: "millions", reviewed: data.has("reviewed"), buckets, source: importedSource(data),
    });
    if (imported) { form.reset(); setMaturityRows([blankMaturityRow()]); }
  }

  async function importRating(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memo) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const imported = await importEvidence("ratings", {
      ticker: memo.company.ticker, agency: String(data.get("agency") ?? ""), rating: String(data.get("rating") ?? "").trim(),
      scope: String(data.get("scope") ?? "").trim(), asOf: String(data.get("asOf") ?? ""), reviewed: data.has("reviewed"),
      source: importedSource(data),
    });
    if (imported) form.reset();
  }

  async function importTrends(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memo) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("csv");
    if (!(file instanceof File) || !file.size) { setError("Choose a Google Trends CSV export first."); return; }
    const imported = await importEvidence("trends", {
      ticker: memo.company.ticker, csv: await file.text(), query: String(data.get("query") ?? "").trim(),
      geography: String(data.get("geography") ?? "").trim(), periodStart: String(data.get("periodStart") ?? ""),
      periodEnd: String(data.get("periodEnd") ?? ""), retrievedAt: String(data.get("retrievedAt") ?? ""),
      reviewed: data.has("reviewed"), source: importedSource(data, true),
    });
    if (imported) form.reset();
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
  function updateMaturityRow(index: number, field: keyof MaturityRow, value: string) {
    setMaturityRows((current) => current.map((row, itemIndex) => itemIndex === index ? { ...row, [field]: value } : row));
  }
  function sourceLabel(source: Source): string { return `${source.title}${source.publishedAt ? ` · ${source.publishedAt}` : ""}`; }
  const reviewReady = Boolean(memo?.insights.length) && (memo?.insights.every((insight) => insight.reviewed && insight.evidenceIds.length > 0 && insight.evidenceIds.every((id) => {
    const source = memo.sources.find((item) => item.id === id);
    return Boolean(source && (source.kind === "filing" && source.provenance !== "analyst-supplied" || source.reviewed === true));
  })) ?? false);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">F<span>·</span></span><div><strong>FIELDNOTE</strong><small>CREDIT RESEARCH STUDIO</small></div></div>
      <div className="sidebar-rule" />
      <div className="sidebar-section-label">WORKSPACE <span>01 / LOCAL</span></div>
      <div className="side-intro"><h2>Understand the company,<br /><em>then the numbers.</em></h2><p>A source-backed first pass for public-company credit research. The two-page format is under review.</p></div>

      <div className="side-block"><div className="side-block-heading"><span>01</span><h3>Choose a company</h3></div>
        <label htmlFor="ticker">COMPANY NAME OR TICKER</label><div className="ticker-box"><input id="ticker" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="company-suggestions" aria-activedescendant={activeSuggestion >= 0 ? `company-option-${suggestions[activeSuggestion]?.ticker}` : undefined} value={ticker} onChange={(event) => { setTicker(event.target.value); setSelectedTicker(null); }} onKeyDown={(event) => {
          if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setActiveSuggestion((current) => (current + 1) % Math.min(5, suggestions.length)); }
          if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setActiveSuggestion((current) => (current <= 0 ? Math.min(5, suggestions.length) : current) - 1); }
          if (event.key === "Enter" && suggestions.length) { event.preventDefault(); selectCompany(suggestions[activeSuggestion >= 0 ? activeSuggestion : 0]); }
          if (event.key === "Escape") { setSuggestions([]); setActiveSuggestion(-1); }
        }} placeholder="WMT or Walmart" maxLength={60} autoComplete="off" /><span aria-hidden="true">↗</span></div>
        {suggestions.length > 0 && <div className="suggestions" id="company-suggestions" role="listbox" aria-label="Company search results">{suggestions.slice(0, 5).map((company, index) => <button id={`company-option-${company.ticker}`} role="option" aria-selected={index === activeSuggestion} key={company.ticker} onClick={() => selectCompany(company)}><b>{company.ticker}</b><span>{company.name}</span></button>)}</div>}
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
          <label htmlFor={`source-title-${index}`}>TITLE</label><input id={`source-title-${index}`} placeholder="Article or release title" value={source.title} onChange={(event) => updateSource(index, "title", event.target.value)} />
          <label htmlFor={`source-url-${index}`}>PUBLIC URL</label><input id={`source-url-${index}`} type="url" placeholder="https://…" value={source.url} onChange={(event) => updateSource(index, "url", event.target.value)} />
          <label htmlFor={`source-date-${index}`}>PUBLICATION DATE · REQUIRED</label><input id={`source-date-${index}`} type="date" max={new Date().toISOString().slice(0, 10)} required value={source.publishedAt ?? ""} onChange={(event) => updateSource(index, "publishedAt", event.target.value)} />
          <label htmlFor={`source-note-${index}`}>VERIFIED EVIDENCE NOTE</label><textarea id={`source-note-${index}`} placeholder="Fact or event checked against this source" value={source.note} onChange={(event) => updateSource(index, "note", event.target.value)} rows={3} />
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
        {memo && !memo.id.startsWith("pilot-") && <div className="review-panel"><div className="review-heading"><div><span className="eyebrow">ANALYST CONTROL</span><h2>Review the narrative</h2></div><span className={`review-badge ${memo.reviewStatus}`}>{memo.reviewStatus}</span></div><p>Open each cited source, verify its publication date and evidence note, then check every narrative claim. Editing a line returns the memo to draft status.</p>
          {memo.sources.some((source) => source.provenance === "analyst-supplied" && source.kind !== "filing") && <div className="source-review-list"><span className="eyebrow">SOURCE REVIEW</span>{memo.sources.filter((source) => source.provenance === "analyst-supplied" && source.kind !== "filing").map((source) => <div className="source-review-row" key={source.id}><label><input type="checkbox" checked={source.reviewed === true} disabled={Boolean(busy)} onChange={(event) => void reviewSource(source.id, event.target.checked)} /><span>{source.reviewed ? "Reviewed" : "Review pending"}</span></label><div><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><small>{source.publishedAt ?? "Date N/A"} · {source.access}</small></div></div>)}</div>}
          {memo.insights.map((insight, index) => <div className="review-row" key={insight.id}><div className="review-row-header"><span>0{index + 1} / {insight.kind.toUpperCase()}</span><label><input type="checkbox" checked={insight.reviewed} onChange={(event) => setMemo((current) => current ? { ...current, insights: current.insights.map((item) => item.id === insight.id ? { ...item, reviewed: event.target.checked } : item), reviewStatus: "draft" } : null)} /> Verified</label></div><textarea value={insight.text} onChange={(event) => setMemo((current) => current ? { ...current, insights: current.insights.map((item) => item.id === insight.id ? { ...item, text: event.target.value, reviewed: false } : item), reviewStatus: "draft" } : null)} rows={3} /><small>Evidence: {insight.evidenceIds.map((id) => memo.sources.find((source) => source.id === id)?.title ?? id).join(" · ") || "Source review needed"}</small></div>)}
          <div className="review-actions"><button className="outline-button" onClick={() => saveInsights(memo.insights)} disabled={Boolean(busy)}>Save draft</button><button className="solid-button" onClick={() => saveInsights(memo.insights, "reviewed")} disabled={Boolean(busy) || !reviewReady}>Mark reviewed</button></div>{!reviewReady && <p className="review-help">Review every insight and its cited public source before marking the memo reviewed.</p>}
        </div>}
      </div>

      <aside className="right-rail"><div className="rail-card rail-summary"><span className="eyebrow">METHOD / 01</span><h3>Evidence before opinion.</h3><p>Every number keeps its filing trail. Commentary stays in draft until you check the underlying sources.</p><div className="rail-line"><span>FILINGS</span><b>{memo ? memo.sources.filter((source) => source.kind === "filing").length : "—"}</b></div><div className="rail-line"><span>PUBLIC SOURCES</span><b>{memo ? memo.sources.filter((source) => source.access === "public" && source.kind !== "filing").length : "—"}</b></div><div className="rail-line"><span>AI MODE</span><b>{memo ? memo.generationMode === "openai" ? "DRAFTED" : "LOCAL" : "—"}</b></div></div>
        {memo && <div className="rail-card"><span className="eyebrow">SOURCE REGISTER</span><h3>Trace the memo</h3><div className="source-register">{memo.sources.filter((source) => source.access === "public").slice(0, 20).map((source, index) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span>[{memo.sources.indexOf(source) + 1}]</span><p>{sourceLabel(source)}</p><b>↗</b></a>)}</div></div>}
        {memo && !memo.id.startsWith("pilot-") && <div className="rail-card evidence-card"><span className="eyebrow">SOURCE-LINKED INPUTS</span><h3>Complete the evidence</h3><p>Import only figures checked against the original document. Leave unknown debt splits blank; the memo will show N/A until an input is reviewed.</p>
          <details><summary>Debt maturity schedule</summary><form onSubmit={(event) => void importMaturities(event)}><p>USD millions · scheduled principal, not carrying debt. Include every dated bucket and a final “Thereafter” row when reported.</p><label>As-of date<input name="asOf" type="date" required /></label><label>Schedule basis<input name="basis" required minLength={5} maxLength={240} placeholder="Scheduled principal payments" /></label>
            <div className="maturity-editor"><span className="tiny-label">MATURITY BUCKETS</span>{maturityRows.map((row, index) => <div className="maturity-editor-row" key={index}><div><label>Label<input value={row.label} onChange={(event) => updateMaturityRow(index, "label", event.target.value)} required placeholder="2028 or Thereafter" /></label><label>Fiscal year<input value={row.fiscalYear} onChange={(event) => updateMaturityRow(index, "fiscalYear", event.target.value)} type="number" min="2000" max="2200" placeholder="Blank for Thereafter" /></label></div><div><label>Senior<input value={row.senior} onChange={(event) => updateMaturityRow(index, "senior", event.target.value)} type="number" min="0" step="any" placeholder="N/A" /></label><label>Junior<input value={row.junior} onChange={(event) => updateMaturityRow(index, "junior", event.target.value)} type="number" min="0" step="any" placeholder="N/A" /></label><label>Unclassified<input value={row.unclassified} onChange={(event) => updateMaturityRow(index, "unclassified", event.target.value)} type="number" min="0" step="any" placeholder="N/A" /></label></div>{maturityRows.length > 1 && <button type="button" className="evidence-remove" onClick={() => setMaturityRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove row</button>}</div>)}</div><button type="button" className="evidence-add" onClick={() => setMaturityRows((current) => [...current, blankMaturityRow()])}>+ Add maturity bucket</button><EvidenceSourceFields /><label className="evidence-verified"><input name="reviewed" type="checkbox" /> I checked the amounts and seniority against this source</label><button type="submit" disabled={Boolean(busy)}>Import maturity schedule</button></form></details>
          <details><summary>Credit rating</summary><form onSubmit={(event) => void importRating(event)}><label>Agency<select name="agency" defaultValue="Moody's"><option>Moody&apos;s</option><option>S&amp;P</option><option>Fitch</option><option>Other</option></select></label><label>Grade<input name="rating" required maxLength={16} placeholder="A1" /></label><label>Scope<input name="scope" required minLength={3} maxLength={100} placeholder="Senior unsecured issuer" /></label><label>Rating as of<input name="asOf" type="date" required /></label><EvidenceSourceFields /><label className="evidence-verified"><input name="reviewed" type="checkbox" /> I checked the grade, scope, and date against this source</label><button type="submit" disabled={Boolean(busy)}>Import rating</button></form></details>
          <details><summary>Google Trends export</summary><form onSubmit={(event) => void importTrends(event)}><p>Export one query from Google Trends. Query, geography, and dates must match the CSV.</p><label>CSV file<input name="csv" type="file" accept=".csv,text/csv" required /></label><label>Query<input name="query" required maxLength={100} placeholder="Walmart" /></label><label>Geography<input name="geography" required maxLength={100} placeholder="United States" /></label><label>Period start<input name="periodStart" type="date" required /></label><label>Period end<input name="periodEnd" type="date" required /></label><label>Retrieved on<input name="retrievedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><EvidenceSourceFields publicOnly /><label className="evidence-verified"><input name="reviewed" type="checkbox" /> I checked the CSV against the stated query and period</label><button type="submit" disabled={Boolean(busy)}>Import Trends CSV</button></form></details>
        </div>}
        {memo && !memo.id.startsWith("pilot-") && <div className="rail-card industry-card"><span className="eyebrow">LICENSED INDUSTRY CONTEXT</span><h3>IBISWorld</h3><p>Choose a report code from your licensed account. This section remains local and is excluded from AI prompts.</p><div className="industry-form"><input value={reportCode} onChange={(event) => setReportCode(event.target.value)} placeholder="Report code" aria-label="IBISWorld report code" /><button onClick={addIndustry} disabled={Boolean(busy) || !reportCode.trim()}>Load</button></div>{memo.industry && <details className="industry-detail"><summary>Connected: {memo.industry.reportTitle}</summary><p>{memo.industry.summary}</p></details>}</div>}
        <div className="rail-card saved-card"><span className="eyebrow">LOCAL ARCHIVE</span><h3>Recent memos</h3>{saved.length ? saved.map((item) => <button key={item.id} onClick={() => openMemo(item.id)}><span><b>{item.company.ticker}</b><small>{new Date(item.generatedAt).toLocaleDateString()}</small></span><span>↗</span></button>) : <p>No memos yet. Generate the first pilot to begin.</p>}</div>
      </aside></div>
    </main>
  </div>;
}
