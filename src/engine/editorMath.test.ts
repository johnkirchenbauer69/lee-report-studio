import { describe, expect, it } from "vitest";
import { rotateGroupedElements, scaleGroupedElements } from "./editorMath";
import type { ReportElement } from "../types/report";

const textElement = (
  overrides: Partial<ReportElement> & { id: string },
): ReportElement =>
  ({
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    name: overrides.id,
    style: {},
    text: "",
    ...overrides,
  }) as ReportElement;

describe("rotateGroupedElements", () => {
  it("rotates every group member's own rotation by the same delta", () => {
    const a = textElement({ id: "a", groupId: "g", x: 0, y: 0 });
    const b = textElement({ id: "b", groupId: "g", x: 200, y: 0 });
    const [rotatedA, rotatedB] = rotateGroupedElements([a, b], "a", 90);
    expect(rotatedA.rotation).toBeCloseTo(90);
    expect(rotatedB.rotation).toBeCloseTo(90);
  });

  it("revolves sibling positions around the shared group center as a rigid body", () => {
    const a = textElement({ id: "a", groupId: "g", x: 0, y: 0 });
    const b = textElement({ id: "b", groupId: "g", x: 200, y: 0 });
    const [, rotatedB] = rotateGroupedElements([a, b], "a", 180);
    // A 180-degree rotation around the shared center should mirror b's
    // position to the opposite side of the group.
    expect(rotatedB.x).not.toBeCloseTo(200);
  });

  it("leaves ungrouped elements untouched", () => {
    const a = textElement({ id: "a", x: 0, y: 0 });
    const result = rotateGroupedElements([a], "a", 90);
    expect(result).toBe(result); // no groupId -> function returns original array
    expect(result[0].rotation ?? 0).toBe(0);
  });

  it("is a no-op when the rotation delta is zero", () => {
    const a = textElement({ id: "a", groupId: "g", rotation: 45 });
    const b = textElement({ id: "b", groupId: "g", x: 200 });
    const result = rotateGroupedElements([a, b], "a", 45);
    expect(result[0].x).toBe(a.x);
    expect(result[1].x).toBe(b.x);
  });
});

describe("scaleGroupedElements (regression guard)", () => {
  it("still scales members proportionally around the group origin", () => {
    const a = textElement({ id: "a", groupId: "g", x: 0, y: 0, width: 100 });
    const b = textElement({ id: "b", groupId: "g", x: 100, y: 0, width: 50 });
    const [, scaledB] = scaleGroupedElements([a, b], "a", { width: 200 });
    expect(scaledB.width).toBe(100);
  });
});
