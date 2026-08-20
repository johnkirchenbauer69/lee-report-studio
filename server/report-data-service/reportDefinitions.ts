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
  "industrial-market-report-data-v2-verified-salesforce";

export const industrialMarketMetricDefinitions: readonly MetricDefinition[] = [
  {
    metricPath: "overallMarket.vacancyRate",
    version: "v1",
    sourceObject: "Market_Data__c",
    sourceField: "Total_Vacant_Percent__c",
    calculation: "inventory-weighted submarket cross-check",
    authority: "historical Market_Data aggregate",
    timeContext: "historical-period",
  },
  {
    metricPath: "overallMarket.availabilityRate",
    version: "v1",
    sourceObject: "Market_Data__c",
    sourceField: "Total_Available_Percent__c",
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
    sourceObject: "Market_Data_Contributor__c",
    calculation:
      "Quarter_Label__c; active and included; Sort_Value, Metric_Value, Rank",
    authority: "period-frozen historical contributor selection",
    timeContext: "historical-period",
  },
] as const;
