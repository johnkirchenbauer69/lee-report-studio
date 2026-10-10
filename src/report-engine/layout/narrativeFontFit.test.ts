import { describe, expect, it } from "vitest";
import {
  fitNarrativeFontSize,
  NARRATIVE_FONT_FIT,
  PX_PER_PT,
} from "./narrativeFontFit";

/**
 * A text box model: content height grows with font size (line height and
 * paragraph spacing scale with it), like real wrapped prose.
 */
const box = (availableHeight: number, heightPerPx: number, availableWidth = 400, widthAt?: (px: number) => number) =>
  (fontSizePx: number) => ({
    contentHeight: fontSizePx * heightPerPx,
    availableHeight,
    contentWidth: widthAt ? widthAt(fontSizePx) : availableWidth,
    availableWidth,
  });

const BASE = 12; // authored size in px

describe("fitNarrativeFontSize", () => {
  it("uses the full +2 pt when the text comfortably fits", () => {
    const result = fitNarrativeFontSize(BASE, box(1_000, 20));
    expect(result.increasePt).toBe(2);
    expect(result.fontSizePx).toBeCloseTo(BASE + 2 * PX_PER_PT, 2);
    expect(result.overflow).toBe(false);
  });

  it("never exceeds +2 pt", () => {
    const result = fitNarrativeFontSize(BASE, box(100_000, 1));
    expect(result.fontSizePx).toBeLessThanOrEqual(BASE + 2 * PX_PER_PT + 1e-9);
  });

  it("chooses the largest 0.25 pt step that fits inside the safety margin", () => {
    // 20 px of content per px of font; the box is 300 px tall, so with the
    // 4% margin the usable height is 288 px → font ≤ 14.4 px.
    const result = fitNarrativeFontSize(BASE, box(300, 20));
    expect(result.increasePt % 0.25).toBe(0);
    expect(result.fontSizePx * 20).toBeLessThanOrEqual(300 * (1 - NARRATIVE_FONT_FIT.safetyMargin) + NARRATIVE_FONT_FIT.tolerancePx);
    const nextStep = result.fontSizePx + 0.25 * PX_PER_PT;
    expect(nextStep * 20).toBeGreaterThan(300 * (1 - NARRATIVE_FONT_FIT.safetyMargin) + NARRATIVE_FONT_FIT.tolerancePx);
    expect(result.increasePt).toBe(1.75);
  });

  it("keeps the authored size when the text fits only without the margin", () => {
    // 12 px × 20 = 240 px of content in a 245 px box: fits, but not with 4% free.
    const result = fitNarrativeFontSize(BASE, box(245, 20));
    expect(result).toMatchObject({ fontSizePx: BASE, increasePt: 0, overflow: false });
  });

  it("never shrinks below the authored size and reports overflow instead", () => {
    const result = fitNarrativeFontSize(BASE, box(200, 20));
    expect(result).toMatchObject({ fontSizePx: BASE, increasePt: 0, overflow: true });
  });

  it("treats horizontal overflow (an unbreakable token) as not fitting", () => {
    const result = fitNarrativeFontSize(
      BASE,
      box(1_000, 20, 400, (px) => (px > 13 ? 420 : 390)),
    );
    expect(result.fontSizePx).toBeLessThanOrEqual(13);
    expect(result.overflow).toBe(false);
  });

  it("uses a binary search over the nine candidate sizes", () => {
    const result = fitNarrativeFontSize(BASE, box(300, 20));
    // One floor check plus at most ceil(log2(9)) = 4 probes.
    expect(result.measurements).toBeLessThanOrEqual(5);
  });

  it("supports sizing in points for the fallback PDF renderer", () => {
    const result = fitNarrativeFontSize(9, box(10_000, 10), { unitsPerPt: 1 });
    expect(result.fontSizePx).toBe(11);
  });
});
