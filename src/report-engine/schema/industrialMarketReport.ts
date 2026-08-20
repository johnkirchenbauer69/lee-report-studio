import { z, type ZodError } from "zod";

export const DATASET_SECTIONS = [
  "overallMarket",
  "submarkets",
  "historicalPeriods",
  "leasing",
  "sales",
  "availabilities",
  "deliveries",
  "construction",
  "narrative",
] as const;

export const datasetSectionSchema = z.enum(DATASET_SECTIONS);
export const datasetSectionStatusSchema = z.object({
  section: datasetSectionSchema,
  status: z.enum(["complete", "partial", "missing", "not-requested"]),
  sourceIds: z.array(z.string().min(1)),
  note: z.string().min(1).optional(),
});

export const sourceTypeSchema = z.enum([
  "excel",
  "ascendix",
  "salesforce",
  "pdf",
  "json",
  "manual",
  "sample",
  "calculated",
]);

const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.min(0);
const rate = finiteNumber.min(0).max(1);

export const reportMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  templateId: z.string().min(1),
  market: z.string().min(1),
  period: z.string().min(1),
  preparedBy: z.string().min(1),
});

export const marketMetricsSchema = z.object({
  inventorySf: nonNegativeNumber,
  deliveredSf: nonNegativeNumber,
  underConstructionSf: nonNegativeNumber,
  speculativeShare: rate,
  quarterlyNetAbsorptionSf: finiteNumber,
  vacancyRate: rate,
  availabilityRate: rate,
  askingNetRentPsf: nonNegativeNumber,
  salesVolume: nonNegativeNumber,
});

export const submarketMetricsSchema = marketMetricsSchema.extend({
  name: z.string().min(1),
});

export const historicalMarketPeriodSchema = z.object({
  period: z.string().min(1),
  quarterlyNetAbsorptionSf: finiteNumber,
  trailing12MonthNetAbsorptionSf: finiteNumber.nullable(),
  trailing12MonthNetAbsorptionStatus: z.enum([
    "complete",
    "insufficient_history",
  ]),
  vacancyRate: rate,
  availabilityRate: rate,
  underConstructionSf: nonNegativeNumber,
  leasingActivitySf: nonNegativeNumber,
});

export const leaseRecordSchema = z.object({
  tenant: z.string().min(1),
  sizeSf: nonNegativeNumber,
  address: z.string().min(1),
  leaseType: z.string().min(1),
});

export const saleRecordSchema = z.object({
  buyer: z.string().min(1),
  price: nonNegativeNumber,
  address: z.string().min(1),
  saleType: z.string().min(1),
});

export const propertyHighlightSchema = z.object({
  address: z.string().min(1),
  sizeSf: nonNegativeNumber,
  type: z.string().min(1),
  sponsor: z.string(),
  image: z.string(),
});

export const provenanceRecordSchema = z.object({
  fieldPath: z.string().min(1),
  selectedValue: z.unknown(),
  sources: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        sourceType: sourceTypeSchema,
        value: z.unknown(),
        reference: z.string().min(1).optional(),
        importedAt: z.string().datetime().optional(),
      }),
    )
    .min(1),
  authority: z.string().min(1),
  metricType: z.enum(["quarterly", "trailing-12-month"]).optional(),
  status: z.enum([
    "matched",
    "calculated",
    "reconciled",
    "override",
    "conflict",
    "manual",
  ]),
  critical: z.boolean().optional(),
  note: z.string().min(1).optional(),
  calculation: z
    .object({
      formula: z.string().min(1),
      inputPaths: z.array(z.string().min(1)).min(1),
      inputCount: z.number().int().nonnegative(),
      inputPeriods: z.array(z.string().min(1)).optional(),
      sourceObjects: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export const presentationOverrideSchema = z.object({
  fieldPath: z.string().min(1),
  value: z.unknown(),
  authority: z.string().min(1),
  reason: z.string().min(1),
  sourceReference: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
});

export const industrialMarketReportSchema = z.object({
  report: reportMetadataSchema,
  overallMarket: marketMetricsSchema.extend({ narrative: z.string() }),
  submarkets: z.array(submarketMetricsSchema),
  historicalPeriods: z.array(historicalMarketPeriodSchema),
  leasing: z.array(leaseRecordSchema),
  sales: z.array(saleRecordSchema),
  availabilities: z.array(propertyHighlightSchema),
  deliveries: z.array(propertyHighlightSchema),
  construction: z.array(propertyHighlightSchema),
  provenance: z.array(provenanceRecordSchema),
  presentationOverrides: z.array(presentationOverrideSchema),
  dataCompleteness: z.array(datasetSectionStatusSchema),
});

export type DatasetSection = z.infer<typeof datasetSectionSchema>;
export type DatasetSectionStatus = z.infer<typeof datasetSectionStatusSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;
export type ReportMetadata = z.infer<typeof reportMetadataSchema>;
export type MarketMetrics = z.infer<typeof marketMetricsSchema>;
export type SubmarketMetrics = z.infer<typeof submarketMetricsSchema>;
export type HistoricalMarketPeriod = z.infer<
  typeof historicalMarketPeriodSchema
>;
export type LeaseRecord = z.infer<typeof leaseRecordSchema>;
export type SaleRecord = z.infer<typeof saleRecordSchema>;
export type PropertyHighlight = z.infer<typeof propertyHighlightSchema>;
export type ProvenanceRecord = z.infer<typeof provenanceRecordSchema>;
export type PresentationOverride = z.infer<typeof presentationOverrideSchema>;
export type IndustrialMarketReport = z.infer<
  typeof industrialMarketReportSchema
>;

const fieldLabels: Record<string, string> = {
  vacancyRate: "Vacancy Rate",
  availabilityRate: "Availability Rate",
  speculativeShare: "Speculative Construction Share",
  inventorySf: "Inventory",
  deliveredSf: "Delivered Area",
  underConstructionSf: "Under Construction",
  askingNetRentPsf: "Asking Net Rent",
  salesVolume: "Sales Volume",
  quarterlyNetAbsorptionSf: "Quarterly Net Absorption",
  trailing12MonthNetAbsorptionSf: "12-Month Net Absorption",
};

const valueAtPath = (input: unknown, path: PropertyKey[]) =>
  path.reduce<unknown>(
    (value, key) =>
      value && typeof value === "object"
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined,
    input,
  );

export function describeReportSchemaError(
  error: ZodError,
  input: unknown,
): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String);
    const field = path.at(-1) ?? "report";
    const index = path[0] === "submarkets" ? Number(path[1]) : undefined;
    const submarket = Number.isInteger(index)
      ? valueAtPath(input, ["submarkets", index!, "name"])
      : undefined;
    const label = fieldLabels[field] ?? field;
    const heading = `${typeof submarket === "string" ? submarket : path.slice(0, -1).join(".") || "Report"} — ${label}`;
    const value = valueAtPath(input, issue.path);
    const isRate = [
      "vacancyRate",
      "availabilityRate",
      "speculativeShare",
    ].includes(field);
    const displayValue =
      isRate && typeof value === "number"
        ? `${Math.round(value * 10000) / 100}%`
        : String(value ?? "missing");
    const expected = isRate
      ? "0% to 100%"
      : issue.code === "too_small"
        ? "A non-negative value"
        : issue.message;
    return `${heading}\nValue: ${displayValue}\nExpected: ${expected}`;
  });
}

export function validateIndustrialMarketReport(
  input: unknown,
): IndustrialMarketReport {
  return industrialMarketReportSchema.parse(input);
}
