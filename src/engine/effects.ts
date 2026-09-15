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
 * Flattens an alpha-channel color (`rgba(...)`, `hsla(...)`, or 8-digit
 * `#RRGGBBAA` hex) against an opaque backdrop into a fully opaque
 * `rgb(...)` string. A table cell's tinted background (e.g. a highlighted
 * "current quarter" column) is normally authored as a translucent color so
 * it reads as a light tint over whatever is behind it. That reliance on
 * runtime alpha compositing is fragile for print: a light/low-alpha tint
 * that renders correctly in an on-screen or viewed PDF can fall under a
 * physical printer's minimum reproducible dot/halftone threshold and come
 * out as plain white on paper, even though nothing is wrong with the PDF
 * itself. Pre-compositing the color once here removes that dependency —
 * the exact intended opaque RGB value is what reaches print, with no
 * alpha/compositing step left for the print pipeline to get wrong.
 *
 * `backdrop` defaults to white, the common case (the page background, and
 * every "default"-variant table), but is NOT always correct: some table
 * variants paint their own non-white row/header background underneath a
 * cell (see e.g. `.table-market-matrix` in styles/advanced.css — striped,
 * total, and min/max rows; the indicators/transactions header bands), and
 * flattening against white there would bake in the wrong composited color.
 * Callers with a known non-white backdrop (see `resolveCellBackdrop` in
 * CanvasElement.tsx) should pass it explicitly rather than relying on the
 * default.
 *
 * Fully opaque colors (hex without alpha, `rgb()`/`hsl()`, named colors,
 * `transparent`, css variables, gradients, etc.) are returned unchanged:
 * this only ever touches genuinely alpha-bearing values it can parse.
 */
export const flattenAlphaForPrint = (
  color: string | undefined,
  backdrop: readonly [number, number, number] = [255, 255, 255],
): string | undefined => {
  if (!color) return color;
  const value = color.trim();
  const hex8 = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(
    value,
  );
  if (hex8) {
    const [r, g, b, a] = hex8
      .slice(1)
      .map((part) => Number.parseInt(part, 16));
    return compositeOpaque([r, g, b], a / 255, backdrop);
  }
  const rgba =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      value,
    );
  if (rgba) {
    const [r, g, b] = rgba.slice(1, 4).map(Number);
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    if (a >= 1) return value;
    return compositeOpaque([r, g, b], a, backdrop);
  }
  const hsla =
    /^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      value,
    );
  if (hsla) {
    const a = hsla[4] === undefined ? 1 : Number(hsla[4]);
    if (a >= 1) return value;
    const rgb = hslToRgb(
      Number(hsla[1]),
      Number(hsla[2]) / 100,
      Number(hsla[3]) / 100,
    );
    return compositeOpaque(rgb, a, backdrop);
  }
  return value;
};

const hslToRgb = (
  hue: number,
  saturation: number,
  lightness: number,
): [number, number, number] => {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, saturation));
  const l = Math.max(0, Math.min(1, lightness));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
};

const compositeOpaque = (
  rgb: readonly [number, number, number],
  alpha: number,
  backdrop: readonly [number, number, number],
): string => {
  const a = Math.max(0, Math.min(1, alpha));
  const mix = (channel: number, back: number) =>
    Math.round(channel * a + back * (1 - a));
  return `rgb(${mix(rgb[0], backdrop[0])}, ${mix(rgb[1], backdrop[1])}, ${mix(rgb[2], backdrop[2])})`;
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

// --- Row shadow "continuous band" ---------------------------------------
//
// A plain per-cell box-shadow (even with offsetX 0) paints on all four sides
// of every <td>/<th>, so adjacent cells in a row each cast a shadow along
// their shared left/right border -- a visible seam down every column
// boundary, doubled where two cells' shadows overlap. directionalDropShadowToCss
// mirrors directionalBevelToCss's edge-suppression technique (inset shadow
// layers, restricted to the edges the caller allows) so that when every cell
// in a row suppresses its left/right edges, only the row's true top and/or
// bottom perimeter paints -- one continuous band, not per-cell fragments.
//
// Direction is derived from the shadow's offsetY: a non-negative offsetY
// paints the band at the row's bottom edge (shadow cast "below"), a
// non-positive offsetY paints it at the top edge; offsetY === 0 paints both,
// which reads as a soft symmetric glow. offsetX does not affect a row band
// (a row shadow is inherently a horizontal strip), so left/right are simply
// never painted regardless of the caller's `edges` unless explicitly allowed.
export const directionalDropShadowToCss = (
  shadow?: Partial<DropShadow>,
  edges: BevelEdges = { top: true, bottom: true, left: false, right: false },
): string | undefined => {
  const resolved = resolveDropShadow(shadow);
  if (!resolved.enabled) return undefined;
  const size = Math.max(0, resolved.blur) + Math.max(0, resolved.spread ?? 0);
  if (size <= 0) return undefined;
  const color = shadowColorToCss(resolved.color, resolved.opacity);
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
  const wantEdge = (edge: keyof BevelEdges) => edges[edge] ?? false;
  if (resolved.offsetY >= 0 && wantEdge("bottom"))
    layers.push(`${insetFor("bottom")} ${color}`);
  if (resolved.offsetY <= 0 && wantEdge("top"))
    layers.push(`${insetFor("top")} ${color}`);
  if (resolved.offsetX >= 0 && wantEdge("right"))
    layers.push(`${insetFor("right")} ${color}`);
  if (resolved.offsetX <= 0 && wantEdge("left"))
    layers.push(`${insetFor("left")} ${color}`);
  return layers.length ? layers.join(", ") : undefined;
};
