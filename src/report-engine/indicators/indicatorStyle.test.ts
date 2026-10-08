import { describe, expect, it } from "vitest";
import {
  buildMetricSemanticFields,
  deriveMetricDirection,
  METRIC_SEMANTICS,
} from "./metricSemantics";
import { indicatorColor } from "./indicatorStyle";

describe("publication movement convention", () => {
  it.each(METRIC_SEMANTICS)(
    "colors $metricKey by direction independently of preference",
    (definition) => {
      for (const [current, prior, direction, color] of [
        [2, 1, "up", "#8A941E"],
        [1, 2, "down", "#CD1442"],
        [0, 0, "equal", "#4E131E"],
        [-1, -2, "up", "#8A941E"],
        [-2, -1, "down", "#CD1442"],
      ] as const) {
        const fields = buildMetricSemanticFields(
          [
            { [definition.metricKey]: current },
            { [definition.metricKey]: prior },
          ] as never,
          definition,
        );
        expect(fields.direction).toBe(direction);
        expect(fields.indicatorColor).toBe(color);
      }
    },
  );
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    "distinguishes missing/nonfinite comparison %s from confirmed unchanged",
    (value) => {
      expect(deriveMetricDirection(0, value, METRIC_SEMANTICS[0])).toBe(
        "unavailable",
      );
      expect(indicatorColor("unavailable")).toBe("#6B7280");
      expect(deriveMetricDirection(value, 0, METRIC_SEMANTICS[0])).toBe(
        "unavailable",
      );
    },
  );
  it("uses displayed precision without changing the source values", () => {
    expect(deriveMetricDirection(0.050011, 0.050012, METRIC_SEMANTICS[1])).toBe(
      "equal",
    );
    expect(indicatorColor("equal")).toBe("#4E131E");
  });
});
