import { describe, expect, it } from "vitest";
import {
  DEFAULT_DROP_SHADOW,
  dropShadowToCss,
  resolveDropShadow,
  shadowColorToCss,
  bevelToCss,
  elementBoxShadowToCss,
  directionalBevelToCss,
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

  it("does not change existing output when spread is omitted", () => {
    expect(
      dropShadowToCss(
        { enabled: true, color: "#123456", offsetX: -3, offsetY: 5, blur: 8, opacity: 0.4 },
        { includeSpread: true },
      ),
    ).toBe("-3px 5px 8px rgba(18, 52, 86, 0.4)");
  });

  it("includes spread only when explicitly requested", () => {
    const shadow = { enabled: true, color: "#000", offsetX: 1, offsetY: 2, blur: 3, opacity: 1, spread: 4 };
    expect(dropShadowToCss(shadow)).toBe("1px 2px 3px rgba(0, 0, 0, 1)");
    expect(dropShadowToCss(shadow, { includeSpread: true })).toBe(
      "1px 2px 3px 4px rgba(0, 0, 0, 1)",
    );
  });
});

describe("directionalBevelToCss", () => {
  const bevel = {
    enabled: true,
    size: 3,
    direction: "raised" as const,
    highlightColor: "#ffffff",
    highlightOpacity: 0.5,
    shadowColor: "#000000",
    shadowOpacity: 0.25,
  };

  it("is undefined when disabled or size is zero", () => {
    expect(directionalBevelToCss({ ...bevel, enabled: false })).toBeUndefined();
    expect(directionalBevelToCss({ ...bevel, size: 0 })).toBeUndefined();
    expect(directionalBevelToCss()).toBeUndefined();
  });

  it("paints only the requested edges, never left/right when suppressed", () => {
    const topBottomOnly = directionalBevelToCss(bevel, {
      top: true,
      bottom: true,
      left: false,
      right: false,
    });
    expect(topBottomOnly).toContain("inset 0 3px 3px -3px rgba(255, 255, 255, 0.5)");
    expect(topBottomOnly).toContain("inset 0 -3px 3px -3px rgba(0, 0, 0, 0.25)");
    expect(topBottomOnly).not.toMatch(/inset -?3px 0/);
  });

  it("suppresses one edge for a ribbon sharing its right edge with a header", () => {
    const css = directionalBevelToCss(bevel, {
      top: true,
      left: true,
      bottom: true,
      right: false,
    });
    expect(css).toContain("inset 3px 0 3px -3px rgba(255, 255, 255, 0.5)"); // left highlight
    expect(css).toContain("inset 0 3px 3px -3px rgba(255, 255, 255, 0.5)"); // top highlight
    expect(css).toContain("inset 0 -3px 3px -3px rgba(0, 0, 0, 0.25)"); // bottom shadow
    expect(css).not.toMatch(/inset -3px 0/); // right edge suppressed
  });

  it("swaps highlight/shadow edges for an inset direction", () => {
    const css = directionalBevelToCss({ ...bevel, direction: "inset" });
    expect(css).toContain("inset 0 3px 3px -3px rgba(0, 0, 0, 0.25)"); // top now shadow
    expect(css).toContain("inset 0 -3px 3px -3px rgba(255, 255, 255, 0.5)"); // bottom now highlight
  });
});
