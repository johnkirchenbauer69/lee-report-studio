import type { ValidationItem } from '../types/report';
export function ValidationPanel({ items }: { items: ValidationItem[] }) {
  return <div className="validation-panel"><div className="panel-title">Report Validation</div>{items.map((item,i) => <div className={`validation-row ${item.level}`} key={i}><span>{item.level === 'ok' ? '✓' : item.level === 'warning' ? '⚠' : '✕'}</span>{item.message}</div>)}</div>;
}
