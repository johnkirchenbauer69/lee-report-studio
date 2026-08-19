import { useMemo, useState } from 'react';
import { sampleTemplate } from './data/sampleTemplate';
import { sampleData } from './data/sampleData';
import type { Binding, PreviewMode, ReportElement, ReportPage, ReportTemplate } from './types/report';
import { CanvasElement } from './components/CanvasElement';
import { Inspector } from './components/Inspector';
import { DataBrowser } from './components/DataBrowser';
import { ValidationPanel } from './components/ValidationPanel';
import { validatePage } from './engine/validation';
import './styles/app.css';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const uid = () => Math.random().toString(36).slice(2, 9);

export default function App() {
  const [template, setTemplate] = useState<ReportTemplate>(() => clone(sampleTemplate));
  const [pageId, setPageId] = useState(template.pages[1].id);
  const [selectedId, setSelectedId] = useState<string>();
  const [mode, setMode] = useState<PreviewMode>('data');
  const [zoom, setZoom] = useState(0.72);
  const [leftTab, setLeftTab] = useState<'pages'|'data'|'elements'|'validate'>('pages');

  const page = template.pages.find(p => p.id === pageId) ?? template.pages[0];
  const selected = page.elements.find(e => e.id === selectedId);
  const validations = useMemo(() => validatePage(page, sampleData), [page]);

  const updatePage = (updater: (page: ReportPage) => ReportPage) => {
    setTemplate(t => ({ ...t, pages: t.pages.map(p => p.id === page.id ? updater(p) : p) }));
  };
  const updateElement = (id: string, patch: Partial<ReportElement>) => updatePage(p => ({ ...p, elements: p.elements.map(e => e.id === id ? ({ ...e, ...patch } as ReportElement) : e) }));
  const updateSelected = (patch: Partial<ReportElement>) => selectedId && updateElement(selectedId, patch);

  const addText = () => {
    const id = `text-${uid()}`;
    const el: ReportElement = { id, type:'text', name:'Text', x:80, y:100, width:260, height:50, text:'New text', style:{ fontFamily:'Arial', fontSize:20, fontWeight:600, color:'#101828' } };
    updatePage(p => ({...p, elements:[...p.elements, el]})); setSelectedId(id);
  };
  const addShape = () => {
    const id = `shape-${uid()}`;
    const el: ReportElement = { id, type:'shape', name:'Rectangle', x:80, y:100, width:220, height:100, style:{ background:'#e4e7ec', borderRadius:8 } };
    updatePage(p => ({...p, elements:[...p.elements, el]})); setSelectedId(id);
  };
  const duplicateSelected = () => {
    if (!selected) return; const copy = clone(selected); copy.id = `${copy.type}-${uid()}`; copy.name = `${copy.name} Copy`; copy.x += 20; copy.y += 20;
    updatePage(p => ({...p, elements:[...p.elements, copy]})); setSelectedId(copy.id);
  };
  const deleteSelected = () => {
    if (!selectedId) return; updatePage(p => ({...p, elements:p.elements.filter(e => e.id !== selectedId)})); setSelectedId(undefined);
  };
  const addPage = () => {
    const id = `page-${uid()}`; const p: ReportPage = { id, name:`Page ${template.pages.length+1}`, width:816, height:1056, background:'#ffffff', elements:[] };
    setTemplate(t => ({...t,pages:[...t.pages,p]})); setPageId(id); setSelectedId(undefined);
  };
  const duplicatePage = () => {
    const p = clone(page); p.id=`page-${uid()}`; p.name=`${p.name} Copy`; p.elements=p.elements.map(e=>({...e,id:`${e.type}-${uid()}`} as ReportElement));
    setTemplate(t=>({...t,pages:[...t.pages,p]})); setPageId(p.id); setSelectedId(undefined);
  };
  const deletePage = () => {
    if (template.pages.length===1) return; const remaining=template.pages.filter(p=>p.id!==page.id); setTemplate(t=>({...t,pages:remaining})); setPageId(remaining[0].id); setSelectedId(undefined);
  };
  const downloadTemplate = () => {
    const blob = new Blob([JSON.stringify(template,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='industrial-market-report-template.json'; a.click(); URL.revokeObjectURL(url);
  };
  const reset = () => { setTemplate(clone(sampleTemplate)); setPageId(sampleTemplate.pages[1].id); setSelectedId(undefined); };
  const bind = (path:string, format?:string) => selected && updateSelected({ binding:{ ...(selected.binding ?? {}), path, label:path, format:(format ?? 'text') as Binding['format'] } });

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">L</div><div><strong>LEE Report Studio</strong><span>{template.name} · v{template.version}</span></div></div>
      <div className="top-actions">
        <div className="mode-toggle"><button className={mode==='design'?'active':''} onClick={()=>setMode('design')}>Design</button><button className={mode==='data'?'active':''} onClick={()=>setMode('data')}>Data Preview</button></div>
        <button onClick={()=>setZoom(Math.max(.35,zoom-.1))}>−</button><span className="zoom-label">{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(Math.min(1.2,zoom+.1))}>+</button>
        <button onClick={downloadTemplate}>Export JSON</button><button onClick={()=>window.print()} className="primary">Print / PDF</button>
      </div>
    </header>

    <div className="workspace">
      <nav className="rail">
        <button className={leftTab==='pages'?'active':''} onClick={()=>setLeftTab('pages')}>Pages</button>
        <button className={leftTab==='elements'?'active':''} onClick={()=>setLeftTab('elements')}>Elements</button>
        <button className={leftTab==='data'?'active':''} onClick={()=>setLeftTab('data')}>Data</button>
        <button className={leftTab==='validate'?'active':''} onClick={()=>setLeftTab('validate')}>QA</button>
      </nav>
      <aside className="left-panel">
        {leftTab==='pages' && <><div className="panel-title">Pages</div><div className="page-list">{template.pages.map((p,i)=><button key={p.id} className={p.id===page.id?'active':''} onClick={()=>{setPageId(p.id);setSelectedId(undefined)}}><div className="thumb"><span>{i+1}</span></div><span>{p.name}</span></button>)}</div><div className="panel-actions"><button onClick={addPage}>+ Add Page</button><button onClick={duplicatePage}>Duplicate</button><button onClick={deletePage}>Delete</button></div></>}
        {leftTab==='elements' && <><div className="panel-title">Elements</div><button className="big-action" onClick={addText}>+ Add text</button><button className="big-action" onClick={addShape}>+ Add rectangle</button><div className="layer-list">{page.elements.map(e=><button key={e.id} className={e.id===selectedId?'active':''} onClick={()=>setSelectedId(e.id)}><span>{e.type}</span>{e.name}</button>)}</div><div className="panel-actions"><button onClick={duplicateSelected} disabled={!selected}>Duplicate</button><button onClick={deleteSelected} disabled={!selected}>Delete</button></div></>}
        {leftTab==='data' && <DataBrowser onBind={bind}/>} {leftTab==='validate' && <ValidationPanel items={validations}/>} 
        <button className="reset-link" onClick={reset}>Reset demo template</button>
      </aside>

      <main className="stage" onClick={()=>setSelectedId(undefined)}>
        <div className="canvas-wrap" style={{width:page.width*zoom,height:page.height*zoom}}>
          <div className="page-canvas" style={{width:page.width,height:page.height,background:page.background,transform:`scale(${zoom})`,transformOrigin:'top left'}}>
            {page.elements.map(el=><CanvasElement key={el.id} element={el} data={sampleData} mode={mode} selected={selectedId===el.id} zoom={zoom} onSelect={setSelectedId} onChange={updateElement}/>) }
          </div>
        </div>
      </main>
      <Inspector element={selected} onChange={updateSelected}/>
    </div>
    <footer className="statusbar"><span>{page.name} · {page.elements.length} elements</span><span>{validations.filter(v=>v.level==='warning').length} warnings · sample Ascendix-style data source</span></footer>
  </div>;
}
