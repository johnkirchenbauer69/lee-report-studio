import { describe, expect, it } from "vitest";
import {
  DEFAULT_DROP_SHADOW,
  dropShadowToCss,
  resolveDropShadow,
  shadowColorToCss,
} from "./effects";

describe("element drop shadows", () => {
  it("is disabled by default and supplies subtle first-use values", () => {
    expect(resolveDropShadow()).toEqual(DEFAULT_DROP_SHADOW);
    expect(dropShadowToCss()).toBeUndefined();
  });

  it("renders a deterministic CSS shadow with clamped opacity and blur", () => {
    expect(
      dropShadowToCss({
        enabled: true,
        color: "#123456",
        offsetX: -3,
        offsetY: 5,
        blur: 8,
        opacity: 0.4,
      }),
    ).toBe("-3px 5px 8px rgba(18, 52, 86, 0.4)");
    expect(shadowColorToCss("#000", 2)).toBe("rgba(0, 0, 0, 1)");
  });
});
