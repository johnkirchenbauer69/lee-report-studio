import { describe, expect, it } from "vitest";
import {
  buildMetricSemanticFields,
  deriveMetricDirection,
  deriveMetricSemanticStatus,
  METRIC_SEMANTICS,
  METRIC_SEMANTIC_COLORS,
  type IndicatorMetricKey,
} from "./metricSemantics";

const definition = (metricKey: IndicatorMetricKey) =>
  METRIC_SEMANTICS.find((item) => item.metricKey === metricKey)!;

const status = (
  metricKey: IndicatorMetricKey,
  current: number,
  prior: number,
) => {
  const metric = definition(metricKey);
  return deriveMetricSemanticStatus(
    deriveMetricDirection(current, prior, metric),
    metric.directionPreference,
  );
};

describe("market indicator semantics", () => {
  it.each([
    ["trailing12MonthNetAbsorptionSf", 11, 10, "favorable"],
    ["trailing12MonthNetAbsorptionSf", 9, 10, "unfavorable"],
    ["vacancyRate", 0.049, 0.05, "favorable"],
    ["vacancyRate", 0.051, 0.05, "unfavorable"],
    ["availabilityRate", 0.059, 0.06, "favorable"],
    ["availabilityRate", 0.061, 0.06, "unfavorable"],
    ["leasingActivitySf", 101, 100, "favorable"],
    ["leasingActivitySf", 99, 100, "unfavorable"],
  ] as const)(
    "classifies %s movement semantically",
    (key, current, prior, expected) => {
      expect(status(key, current, prior)).toBe(expected);
    },
  );

  it.each([
    [11, 10],
    [9, 10],
  ])("keeps under-construction movement neutral", (current, prior) => {
    expect(status("underConstructionSf", current, prior)).toBe("neutral");
  });

  it("treats equal displayed values as neutral", () => {
    const vacancy = definition("vacancyRate");
    expect(deriveMetricDirection(0.050011, 0.050012, vacancy)).toBe("equal");
    expect(status("leasingActivitySf", 100.4, 100.2)).toBe("neutral");
  });

  it("uses the exact governed semantic colors", () => {
    expect(METRIC_SEMANTIC_COLORS).toEqual({
      favorable: "#8A941E",
      unfavorable: "#CD1442",
      neutral: "#4E131E",
    });
  });

  it("uses a bar for equal values", () => {
    const equal = buildMetricSemanticFields(
      [{ vacancyRate: 0.05 }, { vacancyRate: 0.05 }] as never,
      definition("vacancyRate"),
    );
    expect(equal).toMatchObject({
      indicatorKind: "bar",
      indicatorGlyph: "",
      indicatorColor: "#4E131E",
    });
  });

  describe("Under Construction direction (quarter over quarter)", () => {
    const construction = (current: unknown, prior?: unknown) =>
      buildMetricSemanticFields(
        (prior === undefined
          ? [{ underConstructionSf: current }]
          : [
              { underConstructionSf: current },
              { underConstructionSf: prior },
            ]) as never,
        definition("underConstructionSf"),
      );

    it("shows an up arrow when construction increased (I-55: 1,535,471 -> 2,545,030)", () => {
      expect(construction(2_545_030, 1_535_471)).toMatchObject({
        direction: "up",
        semanticStatus: "neutral",
        indicatorKind: "arrow",
        indicatorGlyph: "▲",
        indicatorColor: METRIC_SEMANTIC_COLORS.favorable,
      });
    });

    it("shows a down arrow when construction decreased (Chicago South: 1,035,188 -> 671,668)", () => {
      expect(construction(671_668, 1_035_188)).toMatchObject({
        direction: "down",
        semanticStatus: "neutral",
        indicatorKind: "arrow",
        indicatorGlyph: "▼",
        indicatorColor: METRIC_SEMANTIC_COLORS.unfavorable,
      });
    });

    it("shows the flat bar when unchanged (Central DuPage: 367,842 -> 367,842)", () => {
      expect(construction(367_842, 367_842)).toMatchObject({
        direction: "equal",
        indicatorKind: "bar",
        indicatorGlyph: "",
      });
    });

    it.each([
      ["missing prior quarter", 500_000, undefined],
      ["null prior quarter", 500_000, null],
      ["null current quarter", null, 500_000],
    ])("distinguishes unavailable comparison for %s", (_label, current, prior) => {
      expect(construction(current, prior)).toMatchObject({
        direction: "unavailable",
        semanticStatus: "neutral",
        indicatorKind: "unavailable",
        indicatorGlyph: "",
      });
    });

    it("never colors construction movement as favorable or unfavorable", () => {
      for (const [current, prior] of [
        [200, 100],
        [100, 200],
      ])
        expect(construction(current, prior).semanticStatus).toBe("neutral");
    });
  });
});
