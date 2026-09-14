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

/**
 * `includeSpread` is opt-in and only meaningful for a container box-shadow —
 * CSS text-shadow has no spread component. Existing callers (text-shadow,
 * shape/image box-shadow) never pass it, so their output is unchanged.
 */
export const dropShadowToCss = (
  shadow?: Partial<DropShadow>,
  options: { includeSpread?: boolean } = {},
): string | undefined => {
  const resolved = resolveDropShadow(shadow);
  if (!resolved.enabled) return undefined;
  const spread =
    options.includeSpread && resolved.spread
      ? ` ${resolved.spread}px`
      : "";
  return `${resolved.offsetX}px ${resolved.offsetY}px ${Math.max(0, resolved.blur)}px${spread} ${shadowColorToCss(resolved.color, resolved.opacity)}`;
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
  [dropShadowToCss(shadow, { includeSpread: true }), bevelToCss(bevel)]
    .filter(Boolean)
    .join(", ") || undefined;

// --- Header / side-ribbon "continuous group" bevel ---------------------
//
// bevelToCss above is a diagonal, corner-to-corner treatment: correct for a
// single standalone shape, but two adjacent boxes each computing their own
// diagonal bevel do not compose into one surface (see docs/table-appearance
// for the seam analysis). directionalBevelToCss instead paints only a top
// highlight and a bottom shadow (or the reverse for "inset"), and lets the
// caller suppress whichever edges are internal/shared with a neighboring
// element. Two boxes that share an edge and both suppress it paint nothing
// there — the visual result is one continuous bar, not two shadowed boxes.
export interface BevelEdges {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

const ALL_EDGES: Required<BevelEdges> = {
  top: true,
  right: true,
  bottom: true,
  left: true,
};

export const directionalBevelToCss = (
  bevel?: Partial<BevelStyle>,
  edges: BevelEdges = ALL_EDGES,
): string | undefined => {
  const resolved = resolveBevel(bevel);
  if (!resolved.enabled) return undefined;
  const size = Math.max(0, resolved.size);
  if (size === 0) return undefined;
  const raised = resolved.direction === "raised";
  const highlight = shadowColorToCss(
    resolved.highlightColor,
    resolved.highlightOpacity,
  );
  const shadowColor = shadowColorToCss(
    resolved.shadowColor,
    resolved.shadowOpacity,
  );
  // Raised: light source from the top-left, so top+left get the highlight
  // and bottom+right get the shadow. Inset swaps the two.
  const highlightEdges = raised ? ["top", "left"] : ["bottom", "right"];
  const shadowEdges = raised ? ["bottom", "right"] : ["top", "left"];
  const layers: string[] = [];
  const insetFor = (edge: "top" | "right" | "bottom" | "left") => {
    switch (edge) {
      case "top":
        return `inset 0 ${size}px ${size}px -${size}px`;
      case "bottom":
        return `inset 0 -${size}px ${size}px -${size}px`;
      case "left":
        return `inset ${size}px 0 ${size}px -${size}px`;
      case "right":
        return `inset -${size}px 0 ${size}px -${size}px`;
    }
  };
  for (const edge of highlightEdges as (keyof BevelEdges)[])
    if (edges[edge] ?? true) layers.push(`${insetFor(edge)} ${highlight}`);
  for (const edge of shadowEdges as (keyof BevelEdges)[])
    if (edges[edge] ?? true) layers.push(`${insetFor(edge)} ${shadowColor}`);
  return layers.length ? layers.join(", ") : undefined;
};
