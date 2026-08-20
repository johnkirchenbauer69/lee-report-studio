import type { ReportElement } from "../types/report";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export const normalizeRotation = (value = 0): number => {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return Object.is(normalized, -0)
    ? 0
    : normalized < 0
      ? normalized + 360
      : normalized;
};

export const rotatePoint = (
  point: Point,
  center: Point,
  degrees: number,
): Point => {
  const radians = (normalizeRotation(degrees) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
};

export function getRotatedCorners(rect: Rect): [Point, Point, Point, Point] {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((point) => rotatePoint(point, center, rect.rotation ?? 0)) as [
    Point,
    Point,
    Point,
    Point,
  ];
}

export function getRotatedAabb(rect: Rect): Rect {
  const corners = getRotatedCorners(rect);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: 0,
  };
}

export const pointInRotatedRect = (point: Point, rect: Rect): boolean => {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const local = rotatePoint(point, center, -(rect.rotation ?? 0));
  return (
    local.x >= rect.x &&
    local.x <= rect.x + rect.width &&
    local.y >= rect.y &&
    local.y <= rect.y + rect.height
  );
};

export const elementRect = (
  element: Pick<ReportElement, "x" | "y" | "width" | "height" | "rotation">,
): Rect => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
  rotation: element.rotation,
});

/** Magnetic 45-degree stops, with Shift providing a deliberate 15-degree grid. */
export function snapRotation(
  value: number,
  options: { shiftKey?: boolean; bypass?: boolean; threshold?: number } = {},
): number {
  const normalized = normalizeRotation(value);
  if (options.bypass) return normalized;
  if (options.shiftKey)
    return normalizeRotation(Math.round(normalized / 15) * 15);
  const target = Math.round(normalized / 45) * 45;
  return Math.abs(normalized - target) <= (options.threshold ?? 4)
    ? normalizeRotation(target)
    : normalized;
}
