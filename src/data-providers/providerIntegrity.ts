import type {
  IndustrialMarketReport,
  MarketMetrics,
  SourceType,
} from "../report-engine/schema/industrialMarketReport";

export const IMPORTED_METRIC_KEYS: (keyof MarketMetrics)[] = [
  "inventorySf",
  "deliveredSf",
  "underConstructionSf",
  "speculativeShare",
  "netAbsorptionSf",
  "vacancyRate",
  "availabilityRate",
  "askingNetRentPsf",
  "salesVolume",
];

export function addImportedMetricProvenance(
  report: IndustrialMarketReport,
  options: {
    sourceId: string;
    sourceType: Exclude<SourceType, "calculated">;
    importedAt: string;
    reference: (index: number, field: keyof MarketMetrics) => string;
  },
): IndustrialMarketReport {
  const next = structuredClone(report);
  next.submarkets.forEach((submarket, index) => {
    IMPORTED_METRIC_KEYS.forEach((field) => {
      const fieldPath = `submarkets.${submarket.name}.${field}`;
      if (next.provenance.some((record) => record.fieldPath === fieldPath))
        return;
      next.provenance.push({
        fieldPath,
        selectedValue: submarket[field],
        sources: [
          {
            sourceId: options.sourceId,
            sourceType: options.sourceType,
            value: submarket[field],
            reference: options.reference(index, field),
            importedAt: options.importedAt,
          },
        ],
        authority: options.sourceId,
        status: "matched",
      });
    });
  });
  return next;
}
