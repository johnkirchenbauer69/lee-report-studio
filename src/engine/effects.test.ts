import { describe, expect, it } from "vitest";
import {
  DEFAULT_DROP_SHADOW,
  dropShadowToCss,
  resolveDropShadow,
  shadowColorToCss,
  bevelToCss,
  elementBoxShadowToCss,
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

  it("composes a directional bevel with the existing drop shadow", () => {
    const bevel = bevelToCss({
      enabled: true,
      size: 3,
      direction: "raised",
      highlightColor: "#ffffff",
      highlightOpacity: 0.5,
      shadowColor: "#000000",
      shadowOpacity: 0.25,
    });
    expect(bevel).toContain("inset 3px 3px 3px rgba(255, 255, 255, 0.5)");
    expect(bevel).toContain("inset -3px -3px 3px rgba(0, 0, 0, 0.25)");
    expect(elementBoxShadowToCss(undefined, { enabled: true })).toContain(
      "inset",
    );
  });
});
