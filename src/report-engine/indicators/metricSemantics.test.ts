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

  it("uses a bar for equal values and every Under Construction movement", () => {
    const equal = buildMetricSemanticFields(
      [{ vacancyRate: 0.05 }, { vacancyRate: 0.05 }] as never,
      definition("vacancyRate"),
    );
    const construction = buildMetricSemanticFields(
      [{ underConstructionSf: 200 }, { underConstructionSf: 100 }] as never,
      definition("underConstructionSf"),
    );
    expect(equal).toMatchObject({
      indicatorKind: "bar",
      indicatorGlyph: "",
      indicatorColor: "#4E131E",
    });
    expect(construction).toMatchObject({
      direction: "up",
      semanticStatus: "neutral",
      indicatorKind: "bar",
      indicatorGlyph: "",
      indicatorColor: "#4E131E",
    });
  });
});
