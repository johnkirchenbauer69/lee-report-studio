import { useEffect, useMemo, useState } from "react";
import { BrandLogo, useBrandTypography } from "./BrandLogo";
import type { TemplateVersionSummary } from "../types/templateLibrary";

export type Destination = "home" | "reports" | "templates" | "editor";
export type SavedReportSummary = { id: string; name: string; period: string; status: string; generatedAt: string; modifiedAt?: string; templateVersion: string; revision: number };

export function GlobalNavigation({ destination, onNavigate }: { destination: string; onNavigate?: (destination: Destination) => void }) {
  useBrandTypography();
  return <nav className="application-nav" aria-label="Application navigation">
    <a className="application-brand" href="/" onClick={onNavigate ? e => { e.preventDefault(); onNavigate("home"); } : undefined} aria-label="Lee & Associates Report Studio home"><BrandLogo compact /><span>Report Studio</span></a>
    {([['home', 'Home'], ['reports', 'Reports'], ['templates', 'Templates']] as const).map(([key, label]) => <a key={key} href={`/?workspace=${key}`} aria-current={destination === key ? "page" : undefined} onClick={onNavigate ? e => { e.preventDefault(); onNavigate(key); } : undefined}>{label}</a>)}
    <a href="/?marketAssets=1" aria-current={destination === "market-assets" ? "page" : undefined}>Market Assets</a>
    <a className="launcher-link" href="http://127.0.0.1:8799/" target="_blank" rel="noreferrer">Local app controls</a>
  </nav>;
}

export function ApplicationHub({ destination, templates, onNavigate, onCreate, onOpenReport, onOpenTemplate, onCreateVersion, onRename, onDeleteDraft, loadingDocument }: {
  destination: Destination; templates: TemplateVersionSummary[];
  onNavigate: (destination: Destination) => void; onCreate: () => void;
  onOpenReport: (id: string, exportPdf?: boolean) => void;
  onOpenTemplate: (record: TemplateVersionSummary) => void;
  onCreateVersion: (record: TemplateVersionSummary) => void;
  onRename: (record: TemplateVersionSummary, label: string) => void;
  onDeleteDraft: (record: TemplateVersionSummary) => void;
  loadingDocument: boolean;
}) {
  const [reports, setReports] = useState<SavedReportSummary[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [period, setPeriod] = useState(""), [status, setStatus] = useState(new URLSearchParams(window.location.search).get("status") === "published" ? "published" : ""), [sort, setSort] = useState("recent");
  const [templateTab, setTemplateTab] = useState("draft"), [rename, setRename] = useState<TemplateVersionSummary>();
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch('/api/market-assets/reports');
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Reports could not be loaded.'); }
      setReports(await response.json());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [destination]);
  const filtered = useMemo(() => reports.filter(r => `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()) && (!period || r.period === period) && (!status || r.status === status)).sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : (b.modifiedAt ?? b.generatedAt).localeCompare(a.modifiedAt ?? a.generatedAt)), [reports,search,period,status,sort]);
  const cards = (records: SavedReportSummary[]) => <div className="report-library-list">{records.map(r => <article className="library-card" key={r.id}>
    <div><span className={`document-badge status-${r.status}`}>{r.status}</span><h3>{r.name}</h3><p className="report-period">{r.period} <span>· Template v{r.templateVersion}</span></p><small>{r.modifiedAt ? 'File last modified' : 'Created'} {new Date(r.modifiedAt ?? r.generatedAt).toLocaleString()}</small></div>
    <div className="library-actions"><button className="primary-button" disabled={loadingDocument} onClick={() => onOpenReport(r.id)}>Open report</button><button disabled={loadingDocument} onClick={() => onOpenReport(r.id, true)}>Export PDF</button><a href={`/?marketAssets=1&report=${encodeURIComponent(r.id)}`}>Export Market Assets</a><details><summary>Report details</summary><dl><dt>Saved report</dt><dd>{r.id}</dd><dt>Revision</dt><dd>{r.revision}</dd><dt>Snapshot created</dt><dd>{new Date(r.generatedAt).toLocaleString()}</dd></dl></details></div>
  </article>)}</div>;
  return <main className="application-home">
    {destination === "home" && <div className="dashboard-brand"><BrandLogo /><span>Report Studio</span></div> }
    <div className="destination-heading"><div><p className="eyebrow">LEE &amp; ASSOCIATES</p><h1>{destination === 'home' ? 'Your reports, ready to work on' : destination === 'reports' ? 'Reports' : 'Templates'}</h1><p>{destination === 'templates' ? 'Design reusable layouts. Published templates affect future reports only.' : 'Create a report, continue editing, or export your saved work.'}</p></div><button className="primary-button" disabled={loadingDocument} onClick={onCreate}>Create New Report</button></div>
    {destination === 'home' && <>
      <div className="home-actions">
        <button onClick={() => reports[0] ? onOpenReport(reports[0].id) : onNavigate('reports')} disabled={loadingDocument}><strong>Continue Recent Report</strong><span>{reports[0]?.name ?? 'Find a saved report to continue'}</span></button>
        <button onClick={() => onNavigate('reports')}><strong>Open Saved Reports</strong><span>Browse, search and reopen your work</span></button>
        <button onClick={() => onNavigate('templates')}><strong>Manage Templates</strong><span>Drafts, published layouts and history</span></button>
        <a href="/?marketAssets=1"><strong>Export Market Assets</strong><span>Charts, tables and marketing packages</span></a>
      </div><h2>Recent reports</h2>
    </>}
    {destination !== 'templates' && <>
      {destination === 'reports' && <div className="library-tabs"><button aria-pressed={status === ""} onClick={() => setStatus("")}>All reports</button><button aria-pressed={status === "published"} onClick={() => setStatus("published")}>Published reports</button><button aria-pressed={status === "draft"} onClick={() => setStatus("draft")}>Drafts</button></div>}
      {destination === 'reports' && <div className="library-filters"><label>Search reports<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a report by name" /></label><label>Reporting period<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="">All periods</option>{[...new Set(reports.map(r=>r.period))].sort().reverse().map(p=><option key={p}>{p}</option>)}</select></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['draft','approved','published'].map(s=><option key={s}>{s}</option>)}</select></label><label>Sort<select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Most recently modified</option><option value="name">Report name</option></select></label></div>}
      {loading ? <p role="status">Loading saved reports…</p> : error ? <div role="alert" className="application-error"><p>{error}</p><button onClick={()=>void load()}>Retry loading reports</button></div> : filtered.length ? cards(destination === 'home' ? filtered.slice(0,3) : filtered) : <div className="hub-empty"><h2>{reports.length ? 'No matching reports' : 'Create your first report'}</h2><p>{reports.length ? 'Try another name, period or status.' : 'Saved reports will appear here after you generate a report.'}</p><button onClick={onCreate}>Create Report</button></div>}
    </>}
    {(destination === 'templates' || destination === 'home') && <>
      <h2>{destination === 'home' ? 'Recently edited template drafts' : 'Template library'}</h2>
      {destination === 'templates' && <div className="library-tabs" aria-label="Template status">{[['draft','Drafts'],['published','Published'],['archived','History']].map(([key,label])=><button key={key} aria-pressed={templateTab===key} onClick={()=>setTemplateTab(key)}>{label}</button>)}</div>}
      <div className="template-hub-list">{templates.filter(t=>t.status===(destination === 'home'?'draft':templateTab)).slice(0,destination==='home'?3:undefined).map(t=><article className="library-card" key={`${t.id}@${t.version}`}><div><span className="document-badge">{t.status}</span><h3>{t.label || t.name}</h3><p>Version {t.version} · {t.pageDefinitionCount} page definitions</p><small>Updated {new Date(t.updatedAt).toLocaleString()}</small></div><div className="library-actions"><button className="primary-button" disabled={loadingDocument} onClick={()=>onOpenTemplate(t)}>{t.status==='draft'?'Edit draft':'Open template'}</button><button onClick={()=>onCreateVersion(t)}>Create version</button><button onClick={()=>setRename(t)}>Rename</button>{t.status==='draft'&&<button onClick={()=>onDeleteDraft(t)}>Delete draft</button>}</div></article>)}</div>
      {!templates.some(t=>t.status===templateTab) && destination==='templates' && <p>No templates in this section.</p>}
    </>}
    {rename && <form className="hub-rename" onSubmit={e=>{e.preventDefault();onRename(rename,new FormData(e.currentTarget).get('name') as string);setRename(undefined);}}><label>Template display name<input name="name" defaultValue={rename.label||rename.name} autoFocus /></label><button>Save name</button><button type="button" onClick={()=>setRename(undefined)}>Cancel</button></form>}
  </main>;
}
