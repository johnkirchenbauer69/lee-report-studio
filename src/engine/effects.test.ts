import { describe, expect, it } from "vitest";
import {
  DEFAULT_DROP_SHADOW,
  dropShadowToCss,
  resolveDropShadow,
  shadowColorToCss,
  bevelToCss,
  elementBoxShadowToCss,
  directionalBevelToCss,
  directionalDropShadowToCss,
  flattenAlphaForPrint,
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

describe("directionalDropShadowToCss", () => {
  const shadow = {
    enabled: true,
    color: "#000000",
    offsetX: 0,
    offsetY: 3,
    blur: 4,
    opacity: 0.3,
  };

  it("is undefined when disabled or when blur+spread are both zero", () => {
    expect(directionalDropShadowToCss({ ...shadow, enabled: false })).toBeUndefined();
    expect(directionalDropShadowToCss({ ...shadow, blur: 0, spread: 0 })).toBeUndefined();
    expect(directionalDropShadowToCss()).toBeUndefined();
  });

  it("paints only the bottom edge for a positive offsetY, never left/right", () => {
    const css = directionalDropShadowToCss(shadow)!;
    expect(css).toContain("inset 0 -4px 4px -4px rgba(0, 0, 0, 0.3)");
    expect(css).not.toMatch(/inset 0 4px/); // no top band
    expect(css).not.toMatch(/inset -?4px 0/); // no left/right seam contribution
  });

  it("paints only the top edge for a negative offsetY", () => {
    const css = directionalDropShadowToCss({ ...shadow, offsetY: -3 })!;
    expect(css).toContain("inset 0 4px 4px -4px rgba(0, 0, 0, 0.3)");
    expect(css).not.toMatch(/inset 0 -4px/);
  });

  it("paints both top and bottom bands when offsetY is exactly zero", () => {
    const css = directionalDropShadowToCss({ ...shadow, offsetY: 0 })!;
    expect(css).toContain("inset 0 4px 4px -4px rgba(0, 0, 0, 0.3)");
    expect(css).toContain("inset 0 -4px 4px -4px rgba(0, 0, 0, 0.3)");
  });

  it("never paints left/right unless the caller explicitly allows it", () => {
    const withSides = directionalDropShadowToCss(
      { ...shadow, offsetX: 2 },
      { top: true, bottom: true, left: true, right: true },
    )!;
    expect(withSides).toMatch(/inset -4px 0/); // right allowed + offsetX >= 0
    expect(withSides).not.toMatch(/inset 4px 0/); // left suppressed by offsetX sign
  });

  it("combines blur and spread into one edge size", () => {
    const css = directionalDropShadowToCss({ ...shadow, blur: 2, spread: 3 })!;
    expect(css).toContain("inset 0 -5px 5px -5px");
  });
});

describe("flattenAlphaForPrint", () => {
  it("composites an rgba() tint against a white backdrop into opaque rgb()", () => {
    // A 15%-opacity crimson highlight (#c4123f) over white composites to
    // this exact opaque value; a print pipeline that receives this rgb()
    // directly has no alpha step left to lose.
    expect(flattenAlphaForPrint("rgba(196, 18, 63, 0.15)")).toBe(
      "rgb(246, 219, 226)",
    );
  });

  it("composites an 8-digit hex color's alpha channel the same way", () => {
    // 0x26 / 255 ≈ 0.149 alpha, same crimson -- matches the rgba() case
    // above within a rounding unit.
    expect(flattenAlphaForPrint("#c4123f26")).toBe("rgb(246, 220, 226)");
  });

  it("leaves a fully opaque rgba() (alpha 1) as-is", () => {
    expect(flattenAlphaForPrint("rgba(196, 18, 63, 1)")).toBe(
      "rgba(196, 18, 63, 1)",
    );
  });

  it("leaves plain hex, rgb(), named, and non-color CSS values untouched", () => {
    expect(flattenAlphaForPrint("#c4123f")).toBe("#c4123f");
    expect(flattenAlphaForPrint("rgb(196, 18, 63)")).toBe("rgb(196, 18, 63)");
    expect(flattenAlphaForPrint("transparent")).toBe("transparent");
    expect(flattenAlphaForPrint(undefined)).toBeUndefined();
  });

  it("composites against a caller-supplied backdrop instead of white", () => {
    expect(
      flattenAlphaForPrint("rgba(0, 0, 0, 0.5)", [0, 60, 80]),
    ).toBe("rgb(0, 30, 40)");
  });
});
