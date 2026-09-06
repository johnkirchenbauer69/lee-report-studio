import type { BevelStyle, DropShadow } from "../types/report";

export const DEFAULT_DROP_SHADOW: DropShadow = {
  enabled: false,
  color: "#000000",
  offsetX: 2,
  offsetY: 2,
  blur: 4,
  opacity: 0.25,
};

export const resolveDropShadow = (
  shadow?: Partial<DropShadow>,
): DropShadow => ({ ...DEFAULT_DROP_SHADOW, ...shadow });

export const DEFAULT_BEVEL: BevelStyle = {
  enabled: false,
  size: 3,
  direction: "raised",
  highlightColor: "#ffffff",
  highlightOpacity: 0.55,
  shadowColor: "#000000",
  shadowOpacity: 0.28,
};

export const resolveBevel = (bevel?: Partial<BevelStyle>): BevelStyle => ({
  ...DEFAULT_BEVEL,
  ...bevel,
});

const hexToRgb = (color: string) => {
  const value = color.trim();
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
  if (short)
    return short.slice(1).map((part) => Number.parseInt(`${part}${part}`, 16));
  const full = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  return full?.slice(1).map((part) => Number.parseInt(part, 16));
};

export const shadowColorToCss = (color: string, opacity: number) => {
  const alpha = Math.max(0, Math.min(1, opacity));
  const rgb = hexToRgb(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
};

export const dropShadowToCss = (
  shadow?: Partial<DropShadow>,
): string | undefined => {
  const resolved = resolveDropShadow(shadow);
  if (!resolved.enabled) return undefined;
  return `${resolved.offsetX}px ${resolved.offsetY}px ${Math.max(0, resolved.blur)}px ${shadowColorToCss(resolved.color, resolved.opacity)}`;
};

export const bevelToCss = (bevel?: Partial<BevelStyle>): string | undefined => {
  const resolved = resolveBevel(bevel);
  if (!resolved.enabled) return undefined;
  const size = Math.max(0, resolved.size);
  const raised = resolved.direction === "raised";
  const highlight = shadowColorToCss(
    resolved.highlightColor,
    resolved.highlightOpacity,
  );
  const shadow = shadowColorToCss(resolved.shadowColor, resolved.shadowOpacity);
  return [
    `inset ${raised ? size : -size}px ${raised ? size : -size}px ${size}px ${highlight}`,
    `inset ${raised ? -size : size}px ${raised ? -size : size}px ${size}px ${shadow}`,
  ].join(", ");
};

export const elementBoxShadowToCss = (
  shadow?: Partial<DropShadow>,
  bevel?: Partial<BevelStyle>,
): string | undefined =>
  [dropShadowToCss(shadow), bevelToCss(bevel)].filter(Boolean).join(", ") ||
  undefined;
