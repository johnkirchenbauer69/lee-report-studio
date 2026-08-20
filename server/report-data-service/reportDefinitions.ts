export interface MetricDefinition {
  metricPath: string;
  version: string;
  sourceObject: string;
  sourceField?: string;
  calculation?: string;
  authority: string;
  timeContext: "historical-period" | "current" | "both";
}

export const INDUSTRIAL_MARKET_REPORT_DEFINITION_VERSION =
  "industrial-market-report-data-v1";

export const industrialMarketMetricDefinitions: readonly MetricDefinition[] = [
  {
    metricPath: "overallMarket.vacancyRate",
    version: "v1",
    sourceObject: "Market_Data__c",
    sourceField: "configured:marketData.vacancyRate",
    calculation: "inventory-weighted submarket cross-check",
    authority: "historical Market_Data aggregate",
    timeContext: "historical-period",
  },
  {
    metricPath: "overallMarket.availabilityRate",
    version: "v1",
    sourceObject: "Market_Data__c",
    sourceField: "configured:marketData.availabilityRate",
    calculation: "inventory-weighted submarket cross-check",
    authority: "historical Market_Data aggregate",
    timeContext: "historical-period",
  },
  {
    metricPath: "submarkets",
    version: "v1",
    sourceObject: "Market_Data__c",
    authority: "period-specific submarket records",
    timeContext: "historical-period",
  },
  {
    metricPath: "leasing",
    version: "v1",
    sourceObject: "Lease__c",
    calculation: "period filtered; size descending",
    authority: "period-specific lease records",
    timeContext: "both",
  },
] as const;
