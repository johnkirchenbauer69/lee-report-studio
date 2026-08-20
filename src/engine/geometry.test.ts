import { describe, expect, it } from "vitest";
import {
  getRotatedAabb,
  getRotatedCorners,
  normalizeRotation,
  pointInRotatedRect,
  snapRotation,
} from "./geometry";
import { snapPosition } from "./editorMath";

describe("rotation geometry", () => {
  it("normalizes arbitrary and negative values", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });

  it("rotates around the element center and calculates its AABB", () => {
    const rect = { x: 10, y: 20, width: 100, height: 40, rotation: 90 };
    const corners = getRotatedCorners(rect);
    expect(corners[0].x).toBeCloseTo(80);
    expect(corners[0].y).toBeCloseTo(-10);
    const bounds = getRotatedAabb(rect);
    expect(bounds.x).toBeCloseTo(40);
    expect(bounds.y).toBeCloseTo(-10);
    expect(bounds.width).toBeCloseTo(40);
    expect(bounds.height).toBeCloseTo(100);
  });

  it("uses inverse rotation for deterministic hit testing", () => {
    const rect = { x: 100, y: 100, width: 120, height: 30, rotation: 45 };
    expect(pointInRotatedRect({ x: 160, y: 115 }, rect)).toBe(true);
    expect(pointInRotatedRect({ x: 100, y: 100 }, rect)).toBe(false);
  });

  it("magnetizes near 45-degree stops, supports Shift, and allows Alt bypass", () => {
    expect(snapRotation(88)).toBe(90);
    expect(snapRotation(83)).toBe(83);
    expect(snapRotation(83, { shiftKey: true })).toBe(90);
    expect(snapRotation(88, { bypass: true })).toBe(88);
  });

  it("drag rotation snaps to 90 within the ~5 degree threshold", () => {
    expect(snapRotation(92)).toBe(90);
    expect(snapRotation(86)).toBe(90);
  });

  it("drag rotation snaps to 45 within the ~5 degree threshold", () => {
    expect(snapRotation(47)).toBe(45);
    expect(snapRotation(41)).toBe(45);
  });

  it("free rotation with Alt bypass never snaps, even near a stop angle", () => {
    expect(snapRotation(43, { bypass: true })).toBe(43);
    expect(snapRotation(91, { bypass: true })).toBe(91);
  });

  it("resolves the full 0/45/90/.../360 stop set via normalized 360<->0 wrap", () => {
    [0, 45, 90, 135, 180, 225, 270, 315].forEach((stop) => {
      expect(snapRotation(stop + 3)).toBe(stop === 0 ? 0 : stop);
      expect(snapRotation(stop - 3)).toBe(stop);
    });
    expect(snapRotation(358)).toBe(0);
  });

  it("snaps using rotated visual bounds", () => {
    const result = snapPosition({
      x: 48,
      y: 20,
      width: 100,
      height: 40,
      rotation: 90,
      pageWidth: 200,
      pageHeight: 200,
      others: [],
      snapElements: true,
    });
    expect(result.x).toBe(50);
    expect(result.guides).toContainEqual({ axis: "x", position: 100 });
  });
});
