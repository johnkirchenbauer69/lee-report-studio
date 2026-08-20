import type { Fill, ReportElement, Unit } from "../types/report";
import { elementRect, getRotatedAabb, rotatePoint } from "./geometry";

/** Browser/CSS reference pixel density used throughout the editor. */
export const PX_PER_INCH = 96;
export const toPixels = (value: number, unit: Unit) =>
  unit === "in" ? value * PX_PER_INCH : value;
export const fromPixels = (value: number, unit: Unit) =>
  unit === "in" ? value / PX_PER_INCH : value;
export const unitStep = (unit: Unit, large = false) =>
  unit === "in" ? (large ? 0.125 : 0.01) : large ? 10 : 1;
export const formatUnit = (valuePx: number, unit: Unit) =>
  unit === "in"
    ? Number((valuePx / PX_PER_INCH).toFixed(3))
    : Math.round(valuePx);

export function fillToCss(
  fill: Fill | undefined,
  fallback = "transparent",
): string {
  if (!fill) return fallback;
  if (fill.type === "solid") return fill.color;
  const stops = [...fill.stops].sort((a, b) => a.position - b.position);
  return `linear-gradient(${fill.angle}deg, ${stops.map((stop) => `${stop.color} ${stop.position}%`).join(", ")})`;
}

export interface SnapGuide {
  axis: "x" | "y";
  position: number;
  label?: string;
}
export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

export function snapPosition(args: {
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  rotation?: number;
  others: ReportElement[];
  threshold?: number;
  gridSpacing?: number;
  snapGrid?: boolean;
  snapElements?: boolean;
  margins?: number;
  customXTargets?: number[];
  customYTargets?: number[];
}): SnapResult {
  const { width, height, pageWidth, pageHeight, others } = args;
  const threshold = args.threshold ?? 6;
  let x = args.x;
  let y = args.y;
  const guides: SnapGuide[] = [];
  if (args.snapGrid && args.gridSpacing) {
    x = Math.round(x / args.gridSpacing) * args.gridSpacing;
    y = Math.round(y / args.gridSpacing) * args.gridSpacing;
  }
  const xTargets = [0, pageWidth / 2, pageWidth];
  const yTargets = [0, pageHeight / 2, pageHeight];
  xTargets.push(...(args.customXTargets ?? []));
  yTargets.push(...(args.customYTargets ?? []));
  if (args.margins != null) {
    xTargets.push(args.margins, pageWidth - args.margins);
    yTargets.push(args.margins, pageHeight - args.margins);
  }
  if (args.snapElements) {
    others
      .filter((item) => !item.hidden)
      .forEach((item) => {
        const bounds = getRotatedAabb(elementRect(item));
        xTargets.push(
          bounds.x,
          bounds.x + bounds.width / 2,
          bounds.x + bounds.width,
        );
        yTargets.push(
          bounds.y,
          bounds.y + bounds.height / 2,
          bounds.y + bounds.height,
        );
      });
  }
  const bounds = getRotatedAabb({
    x,
    y,
    width,
    height,
    rotation: args.rotation,
  });
  const xAnchors = [
    { value: bounds.x, offset: bounds.x - x },
    {
      value: bounds.x + bounds.width / 2,
      offset: bounds.x + bounds.width / 2 - x,
    },
    { value: bounds.x + bounds.width, offset: bounds.x + bounds.width - x },
  ];
  const yAnchors = [
    { value: bounds.y, offset: bounds.y - y },
    {
      value: bounds.y + bounds.height / 2,
      offset: bounds.y + bounds.height / 2 - y,
    },
    { value: bounds.y + bounds.height, offset: bounds.y + bounds.height - y },
  ];
  let bestX = threshold + 1;
  let bestY = threshold + 1;
  xTargets.forEach((target) =>
    xAnchors.forEach((anchor) => {
      const delta = Math.abs(target - anchor.value);
      if (delta < bestX && delta <= threshold) {
        bestX = delta;
        x = target - anchor.offset;
        guides.splice(
          0,
          guides.length,
          ...guides.filter((g) => g.axis !== "x"),
          { axis: "x", position: target },
        );
      }
    }),
  );
  yTargets.forEach((target) =>
    yAnchors.forEach((anchor) => {
      const delta = Math.abs(target - anchor.value);
      if (delta < bestY && delta <= threshold) {
        bestY = delta;
        y = target - anchor.offset;
        guides.splice(
          0,
          guides.length,
          ...guides.filter((g) => g.axis !== "y"),
          { axis: "y", position: target },
        );
      }
    }),
  );
  return { x: Math.round(x), y: Math.round(y), guides };
}

export function distribute(
  elements: ReportElement[],
  axis: "x" | "y",
): Map<string, number> {
  const result = new Map<string, number>();
  if (elements.length < 3) return result;
  const ordered = [...elements].sort((a, b) =>
    axis === "x" ? a.x - b.x : a.y - b.y,
  );
  const start = axis === "x" ? ordered[0].x : ordered[0].y;
  const last = ordered[ordered.length - 1];
  const end = axis === "x" ? last.x + last.width : last.y + last.height;
  const total = ordered.reduce(
    (sum, item) => sum + (axis === "x" ? item.width : item.height),
    0,
  );
  const gap = (end - start - total) / (ordered.length - 1);
  let cursor = start;
  ordered.forEach((item) => {
    result.set(item.id, cursor);
    cursor += (axis === "x" ? item.width : item.height) + gap;
  });
  return result;
}

/** Scales every member around the group's top-left bound when one member is resized. */
export function scaleGroupedElements(
  elements: ReportElement[],
  sourceId: string,
  patch: Partial<ReportElement>,
): ReportElement[] {
  const source = elements.find((element) => element.id === sourceId);
  if (!source?.groupId || (patch.width == null && patch.height == null))
    return elements;
  const group = elements.filter(
    (element) => element.groupId === source.groupId,
  );
  const minX = Math.min(...group.map((element) => element.x));
  const minY = Math.min(...group.map((element) => element.y));
  const ratio =
    patch.width != null
      ? patch.width / source.width
      : (patch.height ?? source.height) / source.height;
  const originX = minX + (patch.x != null ? patch.x - source.x : 0);
  const originY = minY + (patch.y != null ? patch.y - source.y : 0);
  return elements.map((element) =>
    element.groupId === source.groupId
      ? {
          ...element,
          x: originX + (element.x - minX) * ratio,
          y: originY + (element.y - minY) * ratio,
          width: Math.max(1, element.width * ratio),
          height: Math.max(1, element.height * ratio),
        }
      : element,
  );
}

/** Rotates every member of a group as a rigid body around the group's shared center. */
export function rotateGroupedElements(
  elements: ReportElement[],
  sourceId: string,
  nextRotation: number,
): ReportElement[] {
  const source = elements.find((element) => element.id === sourceId);
  if (!source?.groupId) return elements;
  const group = elements.filter(
    (element) => element.groupId === source.groupId,
  );
  const bounds = group.reduce(
    (acc, element) => {
      const box = getRotatedAabb(elementRect(element));
      return {
        minX: Math.min(acc.minX, box.x),
        minY: Math.min(acc.minY, box.y),
        maxX: Math.max(acc.maxX, box.x + box.width),
        maxY: Math.max(acc.maxY, box.y + box.height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const delta = nextRotation - (source.rotation ?? 0);
  if (!delta) return elements;
  return elements.map((element) => {
    if (element.groupId !== source.groupId) return element;
    const elementCenter = {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    };
    const rotatedCenter = rotatePoint(elementCenter, center, delta);
    return {
      ...element,
      x: rotatedCenter.x - element.width / 2,
      y: rotatedCenter.y - element.height / 2,
      rotation: (element.rotation ?? 0) + delta,
    };
  });
}
