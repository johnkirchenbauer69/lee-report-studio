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
  id: z.string().min(1).optional(),
  canonicalName: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
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
  deliveredSf: nonNegativeNumber.optional(),
  salesVolume: nonNegativeNumber.optional(),
  /** Verified nominal Market_Data price series; null when the source has no value. */
  medianSalesPricePsf: nonNegativeNumber.nullable().optional(),
  leasingActivitySf: nonNegativeNumber,
});

export const availabilitySizeBucketSchema = z.object({
  bucket: z.enum([
    "20-75k SF",
    "75-150k SF",
    "150-250k SF",
    "250-500k SF",
    "500k SF+",
  ]),
  availableSf: nonNegativeNumber,
  buildingCount: z.number().int().nonnegative(),
});

export const leaseRecordSchema = z.object({
  tenant: z.string().min(1),
  tenantDisplayName: z.string().min(1).optional(),
  isDealConfidential: z.boolean().nullable().optional(),
  /** Verified linked Lease checkbox. Null/undefined means the source was unavailable. */
  isLeeDeal: z.boolean().nullable().optional(),
  sizeSf: nonNegativeNumber,
  address: z.string().min(1),
  leaseType: z.string().min(1),
});

export const saleRecordSchema = z.object({
  buyer: z.string().min(1),
  /** Verified linked Sale checkbox. Null/undefined means the source was unavailable. */
  isLeeDeal: z.boolean().nullable().optional(),
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
  propertyType: z.string().optional(),
  availabilityType: z.string().optional(),
  developmentType: z.string().optional(),
  constructionType: z.string().optional(),
  developer: z.string().optional(),
});

export const absorptionContributorSchema = z.object({
  propertyName: z.string().min(1),
  address: z.string().optional(),
  contributionSf: finiteNumber,
  direction: z.enum(["positive", "negative"]),
  evidenceType: z.literal("property_data_net_absorption"),
  deterministicallyIdentified: z.literal(true),
});

export const submarketDetailSchema = z.object({
  id: z.string().min(1).optional(),
  canonicalName: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  name: z.string().min(1),
  metrics: marketMetricsSchema,
  historicalPeriods: z.array(historicalMarketPeriodSchema),
  narrative: z.string(),
  leasing: z.array(leaseRecordSchema),
  sales: z.array(saleRecordSchema),
  availabilities: z.array(propertyHighlightSchema),
  deliveries: z.array(propertyHighlightSchema),
  construction: z.array(propertyHighlightSchema),
  absorptionContributors: z.array(absorptionContributorSchema).default([]),
  availabilityBySize: z.array(availabilitySizeBucketSchema).optional(),
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
  reconciliation: z
    .object({
      classification: z.enum([
        "matched",
        "known-difference",
        "warning",
        "blocking",
      ]),
      authoritativeValue: finiteNumber.nullable(),
      comparisonValue: finiteNumber.nullable(),
      varianceAbsolute: nonNegativeNumber.nullable(),
      variancePercentage: nonNegativeNumber.nullable(),
      reason: z.string().min(1),
      details: z
        .object({
          determination: z.enum([
            "candidate-match",
            "candidate-set",
            "aggregate-only",
            "known-difference",
          ]),
          explanation: z.string().min(1),
          sourceCriteria: z.array(z.string().min(1)).min(1),
          includedRecordCount: z.number().int().nonnegative(),
          candidateTotalSf: nonNegativeNumber,
          diagnosticOnly: z.literal(true),
          records: z.array(
            z.object({
              propertyDataId: z.string().min(1),
              propertyId: z.string().min(1).nullable(),
              property: z.string().min(1),
              address: z.string().min(1).nullable(),
              buildingSf: nonNegativeNumber,
              canonicalSubmarket: z.string().min(1),
              includedInPropertyDataAggregation: z.boolean(),
              expectedOfficialScope: z.boolean().nullable(),
              classification: z.enum(["candidate", "context"]),
              reason: z.string().min(1),
            }),
          ),
        })
        .optional(),
    })
    .optional(),
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
  submarketDetails: z.array(submarketDetailSchema).default([]),
  historicalPeriods: z.array(historicalMarketPeriodSchema),
  leasing: z.array(leaseRecordSchema),
  sales: z.array(saleRecordSchema),
  availabilities: z.array(propertyHighlightSchema),
  deliveries: z.array(propertyHighlightSchema),
  construction: z.array(propertyHighlightSchema),
  absorptionContributors: z.array(absorptionContributorSchema).default([]),
  availabilityBySize: z.array(availabilitySizeBucketSchema).optional(),
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
export type AvailabilitySizeBucket = z.infer<
  typeof availabilitySizeBucketSchema
>;
export type LeaseRecord = z.infer<typeof leaseRecordSchema>;
export type SaleRecord = z.infer<typeof saleRecordSchema>;
export type PropertyHighlight = z.infer<typeof propertyHighlightSchema>;
export type AbsorptionContributor = z.infer<
  typeof absorptionContributorSchema
>;
export type SubmarketDetail = z.infer<typeof submarketDetailSchema>;
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
