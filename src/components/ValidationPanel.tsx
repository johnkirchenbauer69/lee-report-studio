import type { ValidationItem } from '../types/report';
export function ValidationPanel({ items, onSelect }: { items: ValidationItem[]; onSelect?: (id:string)=>void }) {
  return <div className="validation-panel"><div className="panel-heading"><div><strong>Report QA</strong><span>{items.length} checks</span></div></div>{items.map((item,i) => <button className={`validation-row ${item.level}`} key={i} disabled={!item.elementId} onClick={() => item.elementId && onSelect?.(item.elementId)}><span>{item.level === 'ok' ? '✓' : item.level === 'warning' ? '⚠' : '✕'}</span><em>{item.message}</em></button>)}</div>;
}
