import type { IndustrialMarketReport } from "../schema/industrialMarketReport";

export type IndicatorMetricKey =
  | "trailing12MonthNetAbsorptionSf"
  | "vacancyRate"
  | "availabilityRate"
  | "underConstructionSf"
  | "leasingActivitySf";

export type DirectionPreference =
  "higher_is_better" | "lower_is_better" | "neutral";
export type MetricDirection = "up" | "down" | "equal";
export type MetricSemanticStatus =
  "favorable" | "unfavorable" | "informational" | "neutral";

export interface MetricSemanticDefinition {
  metricKey: IndicatorMetricKey;
  label: string;
  directionPreference: DirectionPreference;
  displayMultiplier: number;
  displayDecimals: number;
}

export const METRIC_SEMANTICS: readonly MetricSemanticDefinition[] = [
  {
    metricKey: "trailing12MonthNetAbsorptionSf",
    label: "12 Month Net Absorption (SF)",
    directionPreference: "higher_is_better",
    displayMultiplier: 1,
    displayDecimals: 0,
  },
  {
    metricKey: "vacancyRate",
    label: "Vacancy Rate",
    directionPreference: "lower_is_better",
    displayMultiplier: 100,
    displayDecimals: 2,
  },
  {
    metricKey: "availabilityRate",
    label: "Availability Rate",
    directionPreference: "lower_is_better",
    displayMultiplier: 100,
    displayDecimals: 2,
  },
  {
    metricKey: "underConstructionSf",
    label: "Under Construction (SF)",
    directionPreference: "neutral",
    displayMultiplier: 1,
    displayDecimals: 0,
  },
  {
    metricKey: "leasingActivitySf",
    label: "Total Leasing Activity (SF)",
    directionPreference: "higher_is_better",
    displayMultiplier: 1,
    displayDecimals: 0,
  },
] as const;

export const METRIC_SEMANTIC_COLORS: Record<MetricSemanticStatus, string> = {
  favorable: "#237A57",
  unfavorable: "#B42318",
  informational: "#16738A",
  neutral: "#66717A",
};

const displayedInteger = (
  value: number,
  definition: MetricSemanticDefinition,
) =>
  Math.round(
    value * definition.displayMultiplier * 10 ** definition.displayDecimals,
  );

export function deriveMetricDirection(
  current: number | null | undefined,
  prior: number | null | undefined,
  definition: MetricSemanticDefinition,
): MetricDirection {
  if (typeof current !== "number" || typeof prior !== "number") return "equal";
  const currentDisplay = displayedInteger(current, definition);
  const priorDisplay = displayedInteger(prior, definition);
  return currentDisplay === priorDisplay
    ? "equal"
    : currentDisplay > priorDisplay
      ? "up"
      : "down";
}

export function deriveMetricSemanticStatus(
  direction: MetricDirection,
  preference: DirectionPreference,
): MetricSemanticStatus {
  if (direction === "equal") return "neutral";
  if (preference === "neutral") return "informational";
  const favorable =
    (preference === "higher_is_better" && direction === "up") ||
    (preference === "lower_is_better" && direction === "down");
  return favorable ? "favorable" : "unfavorable";
}

export const metricDirectionGlyph = (direction: MetricDirection) =>
  direction === "up" ? "▲" : direction === "down" ? "▼" : "→";

export interface MarketIndicatorRow {
  metricKey: IndicatorMetricKey;
  metric: string;
  direction: MetricDirection;
  semanticStatus: MetricSemanticStatus;
  indicatorGlyph: string;
  indicatorColor: string;
  q2: string;
  q1: string;
  q4: string;
  q3: string;
  prior: string;
}

type HistoricalPeriod = IndustrialMarketReport["historicalPeriods"][number];

export function buildMetricSemanticFields(
  periods: HistoricalPeriod[],
  definition: MetricSemanticDefinition,
) {
  const current = periods[0]?.[definition.metricKey];
  const prior = periods[1]?.[definition.metricKey];
  const direction = deriveMetricDirection(
    typeof current === "number" ? current : undefined,
    typeof prior === "number" ? prior : undefined,
    definition,
  );
  const semanticStatus = deriveMetricSemanticStatus(
    direction,
    definition.directionPreference,
  );
  return {
    metricKey: definition.metricKey,
    metric: definition.label,
    direction,
    semanticStatus,
    indicatorGlyph: metricDirectionGlyph(direction),
    indicatorColor: METRIC_SEMANTIC_COLORS[semanticStatus],
  };
}
