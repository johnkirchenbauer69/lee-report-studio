import { z } from 'zod';

export const sourceTypeSchema = z.enum(['excel', 'ascendix', 'salesforce', 'pdf', 'json', 'manual', 'sample']);
export type SourceType = z.infer<typeof sourceTypeSchema>;

const finiteNumber = z.number().finite();

export const reportMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  templateId: z.string().min(1),
  market: z.string().min(1),
  period: z.string().min(1),
  preparedBy: z.string().min(1),
});

export const marketMetricsSchema = z.object({
  inventorySf: finiteNumber,
  deliveredSf: finiteNumber,
  underConstructionSf: finiteNumber,
  speculativeShare: finiteNumber,
  netAbsorptionSf: finiteNumber,
  vacancyRate: finiteNumber,
  availabilityRate: finiteNumber,
  askingNetRentPsf: finiteNumber,
  salesVolume: finiteNumber,
});

export const submarketMetricsSchema = marketMetricsSchema.extend({ name: z.string().min(1) });

export const historicalMarketPeriodSchema = z.object({
  period: z.string().min(1),
  netAbsorption12MonthSf: finiteNumber,
  vacancyRate: finiteNumber,
  availabilityRate: finiteNumber,
  underConstructionSf: finiteNumber,
  leasingActivitySf: finiteNumber,
});

export const leaseRecordSchema = z.object({
  tenant: z.string().min(1),
  sizeSf: finiteNumber,
  address: z.string().min(1),
  leaseType: z.string().min(1),
});

export const saleRecordSchema = z.object({
  buyer: z.string().min(1),
  price: finiteNumber,
  address: z.string().min(1),
  saleType: z.string().min(1),
});

export const propertyHighlightSchema = z.object({
  address: z.string().min(1),
  sizeSf: finiteNumber,
  type: z.string().min(1),
  sponsor: z.string(),
  image: z.string().min(1),
});

export const provenanceRecordSchema = z.object({
  fieldPath: z.string().min(1),
  selectedValue: z.unknown(),
  sources: z.array(z.object({
    sourceId: z.string().min(1),
    sourceType: sourceTypeSchema,
    value: z.unknown(),
    reference: z.string().optional(),
    importedAt: z.string().optional(),
  })).min(1),
  authority: z.string().min(1),
  status: z.enum(['matched', 'reconciled', 'override', 'conflict', 'manual']),
  note: z.string().optional(),
});

export const presentationOverrideSchema = z.object({
  fieldPath: z.string().min(1),
  value: z.unknown(),
  source: z.string().min(1),
  reason: z.string().min(1),
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
});

export type ReportMetadata = z.infer<typeof reportMetadataSchema>;
export type MarketMetrics = z.infer<typeof marketMetricsSchema>;
export type SubmarketMetrics = z.infer<typeof submarketMetricsSchema>;
export type HistoricalMarketPeriod = z.infer<typeof historicalMarketPeriodSchema>;
export type LeaseRecord = z.infer<typeof leaseRecordSchema>;
export type SaleRecord = z.infer<typeof saleRecordSchema>;
export type PropertyHighlight = z.infer<typeof propertyHighlightSchema>;
export type ProvenanceRecord = z.infer<typeof provenanceRecordSchema>;
export type PresentationOverride = z.infer<typeof presentationOverrideSchema>;
export type IndustrialMarketReport = z.infer<typeof industrialMarketReportSchema>;

export function validateIndustrialMarketReport(input: unknown): IndustrialMarketReport {
  return industrialMarketReportSchema.parse(input);
}

