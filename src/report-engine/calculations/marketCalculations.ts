import type {
  IndustrialMarketReport,
  MarketMetrics,
  ProvenanceRecord,
  SubmarketMetrics,
} from "../schema/industrialMarketReport";
import type { ReportGenerationRequest } from "../schema/generation";

const sum = (items: SubmarketMetrics[], key: keyof MarketMetrics) =>
  items.reduce((total, item) => total + item[key], 0);

function weightedAverage(
  items: SubmarketMetrics[],
  value: keyof MarketMetrics,
  weight: keyof MarketMetrics,
): number {
  const denominator = sum(items, weight);
  if (denominator === 0) return 0;
  return (
    items.reduce((total, item) => total + item[value] * item[weight], 0) /
    denominator
  );
}

export function calculateMarketTotals(
  submarkets: SubmarketMetrics[],
): MarketMetrics {
  if (!submarkets.length)
    return {
      inventorySf: 0,
      deliveredSf: 0,
      underConstructionSf: 0,
      speculativeShare: 0,
      netAbsorptionSf: 0,
      vacancyRate: 0,
      availabilityRate: 0,
      askingNetRentPsf: 0,
      salesVolume: 0,
    };
  return {
    inventorySf: sum(submarkets, "inventorySf"),
    deliveredSf: sum(submarkets, "deliveredSf"),
    underConstructionSf: sum(submarkets, "underConstructionSf"),
    speculativeShare: weightedAverage(
      submarkets,
      "speculativeShare",
      "underConstructionSf",
    ),
    netAbsorptionSf: sum(submarkets, "netAbsorptionSf"),
    vacancyRate: weightedAverage(submarkets, "vacancyRate", "inventorySf"),
    availabilityRate: weightedAverage(
      submarkets,
      "availabilityRate",
      "inventorySf",
    ),
    askingNetRentPsf: weightedAverage(
      submarkets,
      "askingNetRentPsf",
      "inventorySf",
    ),
    salesVolume: sum(submarkets, "salesVolume"),
  };
}

export function calculateMetricExtremes(
  submarkets: SubmarketMetrics[],
  key: keyof MarketMetrics,
): { minimum?: SubmarketMetrics; maximum?: SubmarketMetrics } {
  if (!submarkets.length) return {};
  return submarkets.slice(1).reduce(
    (result, item) => ({
      minimum: item[key] < result.minimum![key] ? item : result.minimum,
      maximum: item[key] > result.maximum![key] ? item : result.maximum,
    }),
    { minimum: submarkets[0], maximum: submarkets[0] } as {
      minimum: SubmarketMetrics;
      maximum: SubmarketMetrics;
    },
  );
}

export function calculateWeightedVacancy(
  submarkets: SubmarketMetrics[],
): number {
  return weightedAverage(submarkets, "vacancyRate", "inventorySf");
}

export function selectCalculationUniverse(
  submarkets: SubmarketMetrics[],
  scope: ReportGenerationRequest["calculationScope"],
): SubmarketMetrics[] {
  if (scope.type === "all-submarkets") return submarkets;
  const selected = new Set(scope.submarkets);
  return submarkets.filter((submarket) => selected.has(submarket.name));
}

const formulas: Record<keyof MarketMetrics, string> = {
  inventorySf: "SUM(submarket.inventorySf)",
  deliveredSf: "SUM(submarket.deliveredSf)",
  underConstructionSf: "SUM(submarket.underConstructionSf)",
  speculativeShare:
    "SUM(submarket.underConstructionSf × submarket.speculativeShare) / SUM(submarket.underConstructionSf)",
  netAbsorptionSf: "SUM(submarket.netAbsorptionSf)",
  vacancyRate:
    "SUM(submarket.inventorySf × submarket.vacancyRate) / SUM(submarket.inventorySf)",
  availabilityRate:
    "SUM(submarket.inventorySf × submarket.availabilityRate) / SUM(submarket.inventorySf)",
  askingNetRentPsf:
    "SUM(submarket.inventorySf × submarket.askingNetRentPsf) / SUM(submarket.inventorySf)",
  salesVolume: "SUM(submarket.salesVolume)",
};

export function calculateOverallMarket(
  report: IndustrialMarketReport,
  request: ReportGenerationRequest,
): IndustrialMarketReport {
  const universe = selectCalculationUniverse(
    report.submarkets,
    request.calculationScope,
  );
  const totals = calculateMarketTotals(universe);
  const calculatedAt = new Date().toISOString();
  const provenance = structuredClone(report.provenance);

  (Object.keys(totals) as (keyof MarketMetrics)[]).forEach((field) => {
    const fieldPath = `overallMarket.${field}`;
    const weightField =
      field === "speculativeShare"
        ? "underConstructionSf"
        : ["vacancyRate", "availabilityRate", "askingNetRentPsf"].includes(
              field,
            )
          ? "inventorySf"
          : undefined;
    const inputPaths = universe.flatMap((submarket) => [
      `submarkets.${submarket.name}.${field}`,
      ...(weightField ? [`submarkets.${submarket.name}.${weightField}`] : []),
    ]);
    const calculation = {
      formula: formulas[field],
      inputPaths,
      inputCount: universe.length,
    };
    const calculatedSource = {
      sourceId: "lee-report-calculation-engine",
      sourceType: "calculated" as const,
      value: totals[field],
      reference: `${formulas[field]} across ${universe.length} submarkets`,
      importedAt: calculatedAt,
    };
    const index = provenance.findIndex(
      (record) => record.fieldPath === fieldPath,
    );
    if (index >= 0) {
      provenance[index] = {
        ...provenance[index],
        selectedValue: totals[field],
        sources: [
          ...provenance[index].sources.filter(
            (source) => source.sourceId !== calculatedSource.sourceId,
          ),
          calculatedSource,
        ],
        calculation,
      };
    } else {
      const record: ProvenanceRecord = {
        fieldPath,
        selectedValue: totals[field],
        sources: [calculatedSource],
        authority: "LEE Report Studio calculation engine",
        status: "calculated",
        calculation,
      };
      provenance.push(record);
    }
  });

  return {
    ...report,
    overallMarket: { ...report.overallMarket, ...totals },
    provenance,
  };
}
