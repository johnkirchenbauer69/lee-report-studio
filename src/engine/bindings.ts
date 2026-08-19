import type { Binding } from '../types/report';

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

export function formatValue(value: unknown, binding?: Binding): string {
  if (value == null || value === '') return binding?.fallback ?? '—';
  if (!binding || binding.format === 'text' || !binding.format) return String(value);

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  const decimals = binding.decimals ?? 1;

  switch (binding.format) {
    case 'percentage':
      return `${(numeric * 100).toFixed(decimals)}%`;
    case 'integer':
      return Math.round(numeric).toLocaleString('en-US');
    case 'decimal':
      return numeric.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    case 'sf': {
      const abs = Math.abs(numeric);
      if (abs >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(decimals)}B SF`;
      if (abs >= 1_000_000) return `${(numeric / 1_000_000).toFixed(decimals)}M SF`;
      if (abs >= 1_000) return `${(numeric / 1_000).toFixed(decimals)}K SF`;
      return `${numeric.toLocaleString('en-US')} SF`;
    }
    case 'currency':
      return numeric.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: decimals });
    case 'currency_psf':
      return `$${numeric.toFixed(decimals)}/SF`;
    default:
      return String(value);
  }
}
