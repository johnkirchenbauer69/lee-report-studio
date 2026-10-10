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

/**
 * Where a historical quarter came from. OVERALL_MARKET_RECORD is the
 * first-class Market_Data__c Overall Market row (one row in, one quarter
 * out); SUBMARKET_ROLLUP_FALLBACK is only used when that whole quarter row
 * does not exist; SUBMARKET_MARKET_DATA covers submarket-scoped reports.
 */
export const historicalPeriodSourceSchema = z.object({
  authority: z.enum([
    "OVERALL_MARKET_RECORD",
    "SUBMARKET_ROLLUP_FALLBACK",
    "SUBMARKET_MARKET_DATA",
  ]),
  quarter: z.string().min(1),
  externalIds: z.array(z.string().min(1)).optional(),
  /** Metrics that are null on an existing authoritative row. */
  authoritativeNulls: z.array(z.string().min(1)).optional(),
});

/**
 * Metric values are nullable: a null on an existing first-class Overall
 * Market row is an AUTHORITATIVE_NULL (historical evidence not supportable),
 * never a request to backfill from another source.
 */
export const historicalMarketPeriodSchema = z.object({
  period: z.string().min(1),
  quarterlyNetAbsorptionSf: finiteNumber.nullable(),
  trailing12MonthNetAbsorptionSf: finiteNumber.nullable(),
  trailing12MonthNetAbsorptionStatus: z.enum([
    "complete",
    "insufficient_history",
    "authoritative_null",
  ]),
  vacancyRate: rate.nullable(),
  availabilityRate: rate.nullable(),
  underConstructionSf: nonNegativeNumber.nullable(),
  deliveredSf: nonNegativeNumber.nullable().optional(),
  salesVolume: nonNegativeNumber.nullable().optional(),
  /**
   * Governed count of qualifying, de-duplicated Sale transactions behind
   * `salesVolume` (Market_Data__c.Sales_Transactions__c, summed across the
   * same submarket rows as the volume). Absent when the source does not
   * publish it; never inferred from volume.
   */
  salesTransactions: z.number().int().nonnegative().nullable().optional(),
  /** Verified nominal Market_Data price series; null when the source has no value. */
  medianSalesPricePsf: nonNegativeNumber.nullable().optional(),
  leasingActivitySf: nonNegativeNumber.nullable(),
  source: historicalPeriodSourceSchema.optional(),
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
  /** Canonical Sold SF (Sale.Building_SF__c, denormalized onto the contributor row). Undefined when unavailable. */
  sizeSf: nonNegativeNumber.optional(),
  /**
   * Canonical Sale Price/SF. Prefers the verified Salesforce field
   * (Sale.ascendix__SalePricePerUOM__c); when that source value is absent
   * but price and sizeSf are both known, the data layer (never the
   * presentation layer) derives it as price / sizeSf. Null means neither a
   * source value nor the inputs to derive one were available.
   */
  pricePerSf: nonNegativeNumber.nullable().optional(),
});

export const displayPartySourceSchema = z.enum(["tenant", "owner", "developer"]);

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
  /** Verified Property.ascendix__ExpansionType__c, kept for auditability. */
  developmentTypeRaw: z.string().optional(),
  tenantName: z.string().optional(),
  ownerName: z.string().optional(),
  developerName: z.string().optional(),
  /**
   * Governed display-party resolution: for Built-to-Suit/Expansion
   * properties, tenant -> owner -> developer; otherwise developer -> owner.
   * Null when no party could be resolved. The card UI consumes only this
   * field (and `displayPartySource` for provenance), never the raw
   * tenant/owner/developer fields directly.
   */
  displayParty: z.string().nullable().optional(),
  displayPartySource: displayPartySourceSchema.nullable().optional(),
  /** Id of the Lease record selected as the BTS/Expansion occupant, when tenant-sourced. */
  relatedLeaseId: z.string().optional(),
  /** How the related lease (if any) was matched to this property. */
  displayPartyMatchMethod: z
    .enum(["property-lookup", "normalized-address", "none"])
    .optional(),
});

export const absorptionContributorSchema = z.object({
  propertyName: z.string().min(1),
  address: z.string().optional(),
  contributionSf: finiteNumber,
  direction: z.enum(["positive", "negative"]),
  evidenceType: z.literal("property_data_net_absorption"),
  deterministicallyIdentified: z.literal(true),
});

/**
 * Governed explanatory facts published by the Market Data Engine
 * (market-explanation-v1) as additive Market_Data_Contributor__c rows in the
 * existing schema; see docs/narrative-context-v3.md. Report Studio consumes
 * these verbatim for narrative context; it never derives a cause on its own.
 *
 * Only vacancy_bridge, availability_bridge and pipeline_change have an
 * upstream source today (the six "* Driver" categories). The other types
 * stay representable for future governed sources but nothing maps to them.
 */
export const GOVERNED_EXPLANATORY_FACT_TYPES = [
  "vacancy_bridge",
  "availability_bridge",
  "absorption_bridge",
  "leasing_conversion",
  "pipeline_change",
  "materiality",
  "market_breadth",
  "market_driver",
] as const;

/** Exact market-explanation-v1 evidence vocabulary, plus "unspecified". */
export const GOVERNED_EVIDENCE_STRENGTHS = [
  "confirmed",
  "strong",
  "indicative",
  "unspecified",
] as const;

export const governedExplanatoryFactSchema = z.object({
  factType: z.enum(GOVERNED_EXPLANATORY_FACT_TYPES),
  /** Upstream Contributor_Category__c, e.g. "Vacancy Increase Driver". */
  category: z.string().min(1).optional(),
  /** Upstream Rank_Basis__c. */
  rankBasis: z.string().min(1).optional(),
  /** Upstream Calculation_Version__c / Calc_Notes__c "version". */
  explanationVersion: z.string().min(1).optional(),
  /** Governed driver taxonomy value, e.g. "tenant_move_in", "speculative_delivery", "unknown". */
  driverType: z.string().min(1).optional(),
  label: z.string().min(1),
  /** Publication-ready text: Narrative_Context__c, else Display_Value__c. */
  displayValue: z.string().min(1),
  /** Metric the fact explains: "vacancy", "availability" or "construction". */
  metric: z.string().min(1).optional(),
  value: finiteNumber.nullable().optional(),
  priorValue: finiteNumber.nullable().optional(),
  currentValue: finiteNumber.nullable().optional(),
  changeValue: finiteNumber.nullable().optional(),
  /**
   * Signed share (percent) of the market's net change. Upstream notes it can
   * exceed 100% or be negative when additions and reductions offset.
   */
  materialityPercent: finiteNumber.nullable().optional(),
  evidenceStrength: z.enum(GOVERNED_EVIDENCE_STRENGTHS).optional(),
  populationStatus: z.string().min(1).optional(),
  submarketTransfer: z.boolean().optional(),
  brokerEffect: z.string().min(1).optional(),
  /** Built-to-Suit, Speculative, Partial-Spec, Expansion or Unknown (verbatim). */
  constructionType: z.string().min(1).optional(),
  constructionTypeSource: z.string().min(1).optional(),
  /** Pipeline categories: the start or delivery SF of the event itself. */
  pipelineEventSf: finiteNumber.nullable().optional(),
  /** Count of governed evidence records (the source IDs are not retained). */
  evidenceCount: z.number().int().nonnegative().optional(),
  availability: z
    .object({
      timingClassification: z.string().optional(),
      availabilityEvent: z.string().optional(),
      marketingClassification: z.string().optional(),
      removalCause: z.string().optional(),
      directChangeSf: finiteNumber.nullable().optional(),
      subletChangeSf: finiteNumber.nullable().optional(),
      currentFutureAvailableSf: finiteNumber.nullable().optional(),
      currentAvailableNowSf: finiteNumber.nullable().optional(),
      currentUnknownTimingSf: finiteNumber.nullable().optional(),
    })
    .optional(),
  /** e.g. versioned_authoritative, legacy_unversioned_authoritative. */
  priorSnapshotProvenance: z.string().min(1).optional(),
  priorSnapshotHash: z.string().min(1).optional(),
  comparisonWarnings: z.array(z.string()).optional(),
  /**
   * False when the row is a recognized explanation category but its
   * structured evidence could not be read; such a row may state its
   * measured change but is never causal evidence.
   */
  trusted: z.boolean().optional(),
  diagnostics: z.array(z.string()).optional(),
  rank: finiteNumber.optional(),
  propertyName: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  tenantName: z.string().min(1).optional(),
  /** Leasing conversion: quarter the lease was signed. */
  signedPeriod: z.string().min(1).optional(),
  /** Leasing conversion: quarter occupancy commences (may be future). */
  commencementPeriod: z.string().min(1).optional(),
  narrativeEligible: z.boolean(),
  isConfidential: z.boolean().nullable().optional(),
});
export type GovernedExplanatoryFact = z.infer<
  typeof governedExplanatoryFactSchema
>;

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
  explanatoryFacts: z.array(governedExplanatoryFactSchema).optional(),
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

/**
 * Overall Market headline. Identical to the shared metrics contract except
 * that asking rent may be an AUTHORITATIVE_NULL: a first-class Overall
 * Market Market_Data__c row that publishes no Overall_Net_Rent_SF__c stays
 * null (rendered as unavailable), never $0 and never backfilled. Submarket
 * metrics keep the unchanged non-null contract.
 */
export const overallMarketMetricsSchema = marketMetricsSchema.extend({
  askingNetRentPsf: nonNegativeNumber.nullable(),
});

export const industrialMarketReportSchema = z.object({
  report: reportMetadataSchema,
  overallMarket: overallMarketMetricsSchema.extend({ narrative: z.string() }),
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
  explanatoryFacts: z.array(governedExplanatoryFactSchema).optional(),
  provenance: z.array(provenanceRecordSchema),
  presentationOverrides: z.array(presentationOverrideSchema),
  dataCompleteness: z.array(datasetSectionStatusSchema),
});

export type DatasetSection = z.infer<typeof datasetSectionSchema>;
export type DatasetSectionStatus = z.infer<typeof datasetSectionStatusSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;
export type ReportMetadata = z.infer<typeof reportMetadataSchema>;
export type MarketMetrics = z.infer<typeof marketMetricsSchema>;
export type OverallMarketMetrics = z.infer<typeof overallMarketMetricsSchema>;
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
export type DisplayPartySource = z.infer<typeof displayPartySourceSchema>;
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
