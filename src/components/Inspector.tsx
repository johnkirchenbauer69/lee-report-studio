import type { ReportElement } from '../types/report';

interface Props { element?: ReportElement; onChange: (patch: Partial<ReportElement>) => void; }

export function Inspector({ element, onChange }: Props) {
  if (!element) return <aside className="inspector"><div className="panel-title">Inspector</div><div className="empty-state">Select an element to edit its properties.</div></aside>;
  const setStyle = (key: string, value: unknown) => onChange({ style: { ...element.style, [key]: value } } as Partial<ReportElement>);
  return <aside className="inspector">
    <div className="panel-title">Inspector</div>
    <label>Name<input value={element.name} onChange={e => onChange({ name: e.target.value } as Partial<ReportElement>)} /></label>
    <div className="field-grid"><label>X<input type="number" value={element.x} onChange={e => onChange({ x: Number(e.target.value) } as Partial<ReportElement>)} /></label><label>Y<input type="number" value={element.y} onChange={e => onChange({ y: Number(e.target.value) } as Partial<ReportElement>)} /></label></div>
    <div className="field-grid"><label>Width<input type="number" value={element.width} onChange={e => onChange({ width: Number(e.target.value) } as Partial<ReportElement>)} /></label><label>Height<input type="number" value={element.height} onChange={e => onChange({ height: Number(e.target.value) } as Partial<ReportElement>)} /></label></div>
    {element.type === 'text' && <><label>Text<textarea value={element.text} onChange={e => onChange({ text: e.target.value } as Partial<ReportElement>)} /></label><div className="field-grid"><label>Font size<input type="number" value={element.style.fontSize ?? 14} onChange={e => setStyle('fontSize', Number(e.target.value))}/></label><label>Weight<input type="number" min="100" max="900" step="100" value={element.style.fontWeight ?? 400} onChange={e => setStyle('fontWeight', Number(e.target.value))}/></label></div><label>Text color<input type="color" value={element.style.color ?? '#101828'} onChange={e => setStyle('color', e.target.value)} /></label></>}
    <hr />
    <div className="panel-title small">Data binding</div>
    <label>Data path<input placeholder="market.vacancy_rate" value={element.binding?.path ?? ''} onChange={e => onChange({ binding: e.target.value ? { ...(element.binding ?? { path: '' }), path: e.target.value } : undefined } as Partial<ReportElement>)} /></label>
    {element.binding && <label>Format<select value={element.binding.format ?? 'text'} onChange={e => onChange({ binding: { ...element.binding!, format: e.target.value as never } } as Partial<ReportElement>)}><option value="text">Text</option><option value="percentage">Percentage</option><option value="integer">Integer</option><option value="decimal">Decimal</option><option value="sf">Square Feet</option><option value="currency">Currency</option><option value="currency_psf">$/SF</option></select></label>}
    <div className="check-row"><label><input type="checkbox" checked={!!element.locked} onChange={e => onChange({ locked: e.target.checked } as Partial<ReportElement>)} /> Lock</label><label><input type="checkbox" checked={!!element.hidden} onChange={e => onChange({ hidden: e.target.checked } as Partial<ReportElement>)} /> Hide</label></div>
  </aside>;
}
