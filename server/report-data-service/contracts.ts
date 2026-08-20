import { z } from "zod";
import {
  datasetSectionSchema,
  type DatasetSectionStatus,
  type IndustrialMarketReport,
} from "../../src/report-engine/schema/industrialMarketReport.ts";

const calculationScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all-submarkets") }),
  z.object({
    type: z.literal("selected-submarkets"),
    submarkets: z.array(z.string().min(1)).min(1),
  }),
]);

const timeContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("historical-period"), period: z.string().min(1) }),
  z.object({ type: z.literal("current"), asOf: z.string().datetime() }),
]);

export const reportDataRequestSchema = z
  .object({
    reportType: z
      .literal("industrial-market-report")
      .default("industrial-market-report"),
    market: z.string().min(1).max(120),
    period: z.string().min(1).max(40),
    calculationScope: calculationScopeSchema,
    requestedSections: z.array(datasetSectionSchema).optional(),
    timeContext: timeContextSchema.optional(),
  })
  .transform((request) => ({
    ...request,
    timeContext:
      request.timeContext ??
      ({ type: "historical-period", period: request.period } as const),
  }))
  .refine(
    (request) =>
      request.timeContext.type !== "historical-period" ||
      request.timeContext.period === request.period,
    {
      message:
        "Historical time context period must match the requested period.",
    },
  );

export type ReportDataRequest = z.infer<typeof reportDataRequestSchema>;

export interface ReportSourceMetadata {
  generatedAt: string;
  provider: "ascendix";
  mode: "mock" | "salesforce";
  reportDefinitionVersion: string;
  requestId: string;
  salesforceOrg?: string;
  recordCounts: Record<string, number>;
}

export interface ReportDataResult {
  report: IndustrialMarketReport;
  sourceMetadata: ReportSourceMetadata;
  completeness: DatasetSectionStatus[];
  snapshot: { id: string; hash: string };
}
