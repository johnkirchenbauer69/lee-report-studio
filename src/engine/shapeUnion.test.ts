import { describe, expect, it } from "vitest";
import type { ShapeElement } from "../types/report";
import { createUnionShape, evaluateShapeUnion } from "./shapeUnion";

const rectangle = (id: string, x: number, style = {}): ShapeElement => ({
  id,
  type: "shape",
  shape: "rectangle",
  name: id,
  x,
  y: 10,
  width: 50,
  height: 40,
  style,
});

describe("shape union", () => {
  it("creates one editable path and keeps the topmost style", () => {
    const bottom = rectangle("bottom", 10, { background: "#111111" });
    const top = rectangle("top", 40, {
      fill: { type: "solid", color: "#c4123f" },
      shadow: {
        enabled: true,
        color: "#000000",
        offsetX: 2,
        offsetY: 3,
        blur: 4,
        opacity: 0.3,
      },
    });
    expect(evaluateShapeUnion([bottom, top]).enabled).toBe(true);
    const result = createUnionShape([bottom, top], "union");
    expect(result.shape).toBe("path");
    expect(result.x).toBe(10);
    expect(result.width).toBe(80);
    expect(result.style.fill).toEqual(top.style.fill);
    expect(result.style.shadow).toEqual(top.style.shadow);
    expect(result.pathGeometry?.rings[0].length).toBeGreaterThan(4);
  });

  it("disables union for non-intersecting shapes", () => {
    const availability = evaluateShapeUnion([
      rectangle("one", 0),
      rectangle("two", 100),
    ]);
    expect(availability).toEqual({
      enabled: false,
      reason: "Selected shapes must intersect.",
    });
  });
});
