export type ReportFormat =
  | { type: 'text' }
  | { type: 'percentage'; decimals?: number }
  | { type: 'integer'; decimals?: number }
  | { type: 'decimal'; decimals?: number }
  | { type: 'square-feet'; decimals?: number; compact?: boolean; suffix?: boolean }
  | { type: 'currency'; decimals?: number; compact?: boolean }
  | { type: 'currency-per-square-foot'; decimals?: number };

const locale = 'en-US';

export function formatReportValue(value: unknown, format: ReportFormat): string {
  if (value == null || value === '') return '—';
  if (format.type === 'text') return String(value);
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const decimals = format.decimals ?? (format.type === 'percentage' ? 1 : 0);

  if (format.type === 'percentage') return `${(numeric * 100).toFixed(decimals)}%`;
  if (format.type === 'currency-per-square-foot') return `$${numeric.toFixed(decimals)}/SF`;
  if (format.type === 'square-feet' && format.compact) return `${compactNumber(numeric, decimals)}${format.suffix === false ? '' : ' SF'}`;
  if (format.type === 'currency' && format.compact) return `$${compactNumber(numeric, decimals)}`;
  if (format.type === 'currency') return numeric.toLocaleString(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const rendered = numeric.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return format.type === 'square-feet' && format.suffix !== false ? `${rendered} SF` : rendered;
}

function compactNumber(value: number, decimals: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(decimals)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(decimals)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(decimals)}K`;
  return value.toFixed(decimals);
}

