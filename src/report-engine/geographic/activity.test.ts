import { expect, it } from "vitest";
import { placeActivityLabels } from "./activity";

it("keeps all 15 co-located transaction anchors exact while separating callouts", () => {
  const anchors = Array.from({ length: 15 }, (_, i) => ({ code: `L${i}`, x: 200, y: 300 }));
  const original = structuredClone(anchors);
  const placed = placeActivityLabels(anchors, { left: 10, top: 10, right: 390, bottom: 600 });
  expect(anchors).toEqual(original);
  expect(placed.every(item => item.anchor.x === 200 && item.anchor.y === 300)).toBe(true);
  placed.forEach((item, index) => placed.slice(index + 1).forEach(other =>
    expect(Math.hypot(item.label.x - other.label.x, item.label.y - other.label.y)).toBeGreaterThanOrEqual(23)));
});

it("reports exhausted label space instead of relocating a property", () => {
  expect(() => placeActivityLabels([{ code: "L1", x: 0, y: 0 }], { left: 0, top: 0, right: 1, bottom: 1 })).toThrow("overflow");
  expect(placeActivityLabels([], { left: 0, top: 0, right: 1, bottom: 1 })).toEqual([]);
});
