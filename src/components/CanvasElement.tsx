import React from 'react';
import type { PreviewMode, ReportElement } from '../types/report';
import { formatValue, getByPath } from '../engine/bindings';

interface Props {
  element: ReportElement;
  data: unknown;
  mode: PreviewMode;
  selected: boolean;
  zoom: number;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<ReportElement>) => void;
}

export function CanvasElement({ element, data, mode, selected, zoom, onSelect, onChange }: Props) {
  const startDrag = (e: React.PointerEvent) => {
    if (element.locked) return;
    e.stopPropagation();
    onSelect(element.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = element.x;
    const oy = element.y;
    const move = (ev: PointerEvent) => {
      onChange(element.id, { x: Math.round(ox + (ev.clientX - sx) / zoom), y: Math.round(oy + (ev.clientY - sy) / zoom) } as Partial<ReportElement>);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e: React.PointerEvent) => {
    if (element.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const ow = element.width;
    const oh = element.height;
    const move = (ev: PointerEvent) => {
      onChange(element.id, {
        width: Math.max(30, Math.round(ow + (ev.clientX - sx) / zoom)),
        height: Math.max(20, Math.round(oh + (ev.clientY - sy) / zoom)),
      } as Partial<ReportElement>);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const style: React.CSSProperties = {
    position: 'absolute', left: element.x, top: element.y, width: element.width, height: element.height,
    boxSizing: 'border-box', opacity: element.style.opacity ?? 1, transform: `rotate(${element.rotation ?? 0}deg)`,
    border: selected ? '1px solid #7F56D9' : `${element.style.borderWidth ?? 0}px solid ${element.style.borderColor ?? 'transparent'}`,
    borderRadius: element.style.borderRadius ?? 0, background: element.style.background,
    color: element.style.color, fontFamily: element.style.fontFamily, fontSize: element.style.fontSize,
    fontWeight: element.style.fontWeight, fontStyle: element.style.italic ? 'italic' : undefined,
    textAlign: element.style.textAlign, padding: element.style.padding, overflow: 'hidden', cursor: element.locked ? 'default' : 'move',
  };

  let content: React.ReactNode = null;
  if (element.type === 'text') {
    const value = mode === 'data' && element.binding ? formatValue(getByPath(data, element.binding.path), element.binding) : element.text;
    content = <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.15 }}>{value}</div>;
  } else if (element.type === 'shape') {
    content = null;
  } else if (element.type === 'image') {
    const dynamic = mode === 'data' && element.binding ? getByPath(data, element.binding.path) : undefined;
    const src = typeof dynamic === 'string' ? dynamic : element.src;
    content = src ? <img src={src} alt={element.name} style={{ width: '100%', height: '100%', objectFit: element.fit ?? 'cover', pointerEvents: 'none' }} /> : <div className="image-placeholder">Image</div>;
  } else if (element.type === 'table') {
    const rows = getByPath(data, element.sourcePath);
    const arr = Array.isArray(rows) ? rows.slice(0, element.maxRows ?? rows.length) : [];
    content = <table className="report-table"><thead><tr>{element.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{arr.map((row, i) => <tr key={i}>{element.columns.map(c => <td key={c.key}>{formatValue(getByPath(row, c.path), { path: c.path, format: c.format, decimals: 1 })}</td>)}</tr>)}</tbody></table>;
  } else if (element.type === 'chart') {
    const rows = getByPath(data, element.sourcePath);
    const arr = Array.isArray(rows) ? rows : [];
    const values = arr.map(r => Number(getByPath(r, element.valuePath)) || 0);
    const max = Math.max(...values.map(v => Math.abs(v)), 1);
    content = <div className="chart-wrap"><div className="chart-title">{element.title}</div><svg viewBox={`0 0 ${Math.max(600, arr.length * 100)} 230`} preserveAspectRatio="none">{arr.map((row, i) => {
      const v = values[i]; const barH = Math.abs(v) / max * 145; const x = 40 + i * 105; const base = 175;
      return <g key={i}><line x1={x} x2={x} y1={base} y2={v >= 0 ? base - barH : base + Math.min(barH, 45)} stroke="#475467" strokeWidth="45"/><text x={x} y="218" textAnchor="middle" fontSize="12" fill="#475467">{String(getByPath(row, element.categoryPath)).slice(0,14)}</text></g>;
    })}</svg></div>;
  }

  if (element.hidden) return null;
  return <div style={style} onPointerDown={startDrag} onClick={(e) => { e.stopPropagation(); onSelect(element.id); }}>
    {content}
    {selected && !element.locked && <div className="resize-handle" onPointerDown={startResize} />}
    {selected && <div className="element-badge">{element.name}</div>}
  </div>;
}
