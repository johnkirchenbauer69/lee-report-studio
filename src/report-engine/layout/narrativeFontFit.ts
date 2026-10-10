/**
 * Dynamic narrative font sizing.
 *
 * The template's authored font size is the hard minimum. The renderer may
 * enlarge narrative text by up to +2 pt, in 0.25 pt steps, choosing the
 * largest size whose rendered content (line height and paragraph spacing
 * included, because it is measured, not estimated) fits the actual text box
 * with a small vertical safety margin. Text is never shrunk below the
 * authored size, compressed, or truncated: when it does not fit at the
 * minimum, the result reports overflow and the existing overflow/blocking
 * behavior applies.
 *
 * This runs at layout/render/export time only, in the same CanvasElement
 * code path for the editor preview and the Chromium PDF, so the same text
 * resolves to the same size in both.
 */

/** CSS px per typographic point (the default measurement unit). */
export const PX_PER_PT = 96 / 72;

export const NARRATIVE_FONT_FIT = Object.freeze({
  maxIncreasePt: 2,
  stepPt: 0.25,
  /** Fraction of the box height kept free when enlarging (≈4%). */
  safetyMargin: 0.04,
  /** Sub-pixel tolerance for integer layout measurements. */
  tolerancePx: 0.5,
  /** Measurement units per point: CSS px by default; 1 when sizing in points. */
  unitsPerPt: 96 / 72,
});

export interface NarrativeFitMeasurement {
  contentHeight: number;
  availableHeight: number;
  contentWidth?: number;
  availableWidth?: number;
}

export interface NarrativeFitResult {
  /** Chosen font size in CSS px (≥ the authored size). */
  fontSizePx: number;
  /** Points added above the authored size (0–2, in 0.25 steps). */
  increasePt: number;
  /** True when the content does not fit even at the authored size. */
  overflow: boolean;
  /** Number of measurements taken (binary search, ≤ 5 for 9 candidates). */
  measurements: number;
}

export function fitNarrativeFontSize(
  basePx: number,
  measure: (fontSizePx: number) => NarrativeFitMeasurement,
  options: Partial<Record<keyof typeof NARRATIVE_FONT_FIT, number>> = {},
): NarrativeFitResult {
  const settings = { ...NARRATIVE_FONT_FIT, ...options };
  let measurements = 0;
  const sizeAt = (step: number) =>
    basePx + step * settings.stepPt * settings.unitsPerPt;
  const evaluate = (fontSizePx: number, margin: number) => {
    measurements += 1;
    const result = measure(fontSizePx);
    const heightOk =
      result.contentHeight <=
      result.availableHeight * (1 - margin) + settings.tolerancePx;
    const widthOk =
      result.contentWidth === undefined ||
      result.availableWidth === undefined ||
      result.contentWidth <= result.availableWidth + settings.tolerancePx;
    return heightOk && widthOk;
  };

  // The authored size is the floor. It only needs to fit the box itself;
  // the safety margin applies to enlargement, not to the minimum.
  if (!evaluate(basePx, 0))
    return { fontSizePx: basePx, increasePt: 0, overflow: true, measurements };

  const steps = Math.round(settings.maxIncreasePt / settings.stepPt);
  let low = 0;
  let high = steps;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (evaluate(sizeAt(middle), settings.safetyMargin)) low = middle;
    else high = middle - 1;
  }
  return {
    // Rounded down so the +2 pt ceiling can never be exceeded by rounding.
    fontSizePx: Math.floor(sizeAt(low) * 1000 + 1e-9) / 1000,
    increasePt: low * settings.stepPt,
    overflow: false,
    measurements,
  };
}

/** Window event that asks every mounted narrative to re-measure now. */
export const NARRATIVE_REFIT_EVENT = "lee:refit-narratives";
