import type { CornerRadii, ElementStyle, ReportElement } from "../types/report";

export const DEFAULT_CORNER_RADII: CornerRadii = {
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
  linked: true,
};

export type CornerKey = Exclude<keyof CornerRadii, "linked">;

export function clampCornerRadii(
  radii: CornerRadii,
  width: number,
  height: number,
): CornerRadii {
  const maximum = Math.max(0, Math.min(width, height) / 2);
  const clamp = (value: number) =>
    Math.min(maximum, Math.max(0, Number.isFinite(value) ? value : 0));
  return {
    topLeft: clamp(radii.topLeft),
    topRight: clamp(radii.topRight),
    bottomRight: clamp(radii.bottomRight),
    bottomLeft: clamp(radii.bottomLeft),
    linked: radii.linked,
  };
}

export function resolveCornerRadii(
  style: Pick<ElementStyle, "cornerRadii" | "borderRadius">,
  width: number,
  height: number,
): CornerRadii {
  const legacy = style.borderRadius ?? 0;
  return clampCornerRadii(
    style.cornerRadii ?? {
      topLeft: legacy,
      topRight: legacy,
      bottomRight: legacy,
      bottomLeft: legacy,
      linked: true,
    },
    width,
    height,
  );
}

export const cornerRadiiToCss = (radii: CornerRadii) =>
  `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;

export function updateCornerRadius(
  current: CornerRadii,
  corner: CornerKey,
  value: number,
  width: number,
  height: number,
): CornerRadii {
  const next = current.linked
    ? {
        topLeft: value,
        topRight: value,
        bottomRight: value,
        bottomLeft: value,
        linked: true,
      }
    : { ...current, [corner]: value };
  return clampCornerRadii(next, width, height);
}

export function normalizeElementCorners<T extends ReportElement>(
  element: T,
): T {
  if (element.type !== "shape" && element.type !== "image") return element;
  return {
    ...element,
    style: {
      ...element.style,
      cornerRadii: resolveCornerRadii(
        element.style,
        element.width,
        element.height,
      ),
    },
  };
}
