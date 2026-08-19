import type { Binding } from '../types/report';
import { formatReportValue, type ReportFormat } from '../report-engine/formatting/formatValue';

export function getByPath(source: unknown, path: string): unknown {
  if (!path) return source;
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value == null) return undefined;
    const match = segment.match(/^(.+?)\[(\d+)\]$/);
    if (match) {
      const [, key, index] = match;
      const child = (value as Record<string, unknown>)[key];
      return Array.isArray(child) ? child[Number(index)] : undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, source);
}

export function resolveContextPath(path: string, context?: { name: string; path: string }): string {
  if (!context) return path;
  if (path === context.name) return context.path;
  return path.startsWith(`${context.name}.`) ? `${context.path}.${path.slice(context.name.length + 1)}` : path;
}

export function getByContextPath(source: unknown, path: string, context?: { name: string; path: string }): unknown {
  return getByPath(source, resolveContextPath(path, context));
}

export function formatValue(value: unknown, binding?: Binding): string {
  if (value == null || value === '') return binding?.fallback ?? '—';
  if (!binding || binding.format === 'text' || !binding.format) return String(value);
  const decimals = binding.decimals ?? 1;
  const formats: Record<Exclude<Binding['format'],undefined|'text'>,ReportFormat> = {
    percentage:{type:'percentage',decimals},integer:{type:'integer',decimals:0},decimal:{type:'decimal',decimals},
    sf:{type:'square-feet',decimals,compact:true},currency:{type:'currency',decimals},currency_psf:{type:'currency-per-square-foot',decimals},
  };
  return formatReportValue(value,formats[binding.format]);
}
