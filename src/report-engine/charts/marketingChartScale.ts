export const quarterOrdinal = (period: string) => {
  const match = period.trim().match(/^(\d{4})\s+Q([1-4])$/i);
  return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : Number.NaN;
};

export function chronologicalQuarterWindow<T>(
  rows: T[],
  period: (row: T) => string,
  count = 5,
) {
  return [...rows]
    .filter((row) => Number.isFinite(quarterOrdinal(period(row))))
    .sort((a, b) => quarterOrdinal(period(a)) - quarterOrdinal(period(b)))
    .slice(-count);
}

const niceStep = (span: number, target = 5) => {
  const raw = Math.max(span, Number.EPSILON) / Math.max(target, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
};

export function niceTicks(minimum: number, maximum: number, target = 5) {
  const min = Number.isFinite(minimum) ? minimum : 0;
  const max = Number.isFinite(maximum) ? maximum : 1;
  const step = niceStep(Math.max(max - min, 1), target);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step)
    ticks.push(Object.is(value, -0) ? 0 : value);
  return ticks;
}

export const compactNumber = (value: number) => {
  const absolute = Math.abs(value);
  const signed = (scaled: number, suffix: string) =>
    `${Number(scaled.toFixed(scaled < 10 && scaled % 1 ? 1 : 0))}${suffix}`;
  if (absolute >= 1_000_000_000) return signed(value / 1_000_000_000, "B");
  if (absolute >= 1_000_000) return signed(value / 1_000_000, "M");
  if (absolute >= 1_000) return signed(value / 1_000, "K");
  return Math.round(value).toLocaleString("en-US");
};

export const compactCurrency = (value: number) => `$${compactNumber(value)}`;
export const wholeCurrency = (value: number) => `$${Math.round(value)}`;

export function catmullRomPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  if (points.length === 2)
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  }
  return path;
}
