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
  "industrial-market-report-data-v3-live-verified-chicago";

export const industrialMarketMetricDefinitions: readonly MetricDefinition[] = [
  {
    metricPath: "overallMarket.vacancyRate",
    version: "v1",
    sourceObject: "Market_Data__c",
    sourceField: "Total_Vacant_Percent__c",
    calculation:
      "current headline: Property_Data vacant-SF ratio of sums; trend: 18 Market_Data snapshots",
    authority:
      "Property_Data Overall Market rollup / Market_Data submarket snapshot",
    timeContext: "historical-period",
  },
  {
    metricPath: "overallMarket.availabilityRate",
    version: "v1",
    sourceObject: "Market_Data__c",
    sourceField: "Total_Available_Percent__c",
    calculation:
      "current headline: Property_Data available-SF ratio of sums; trend: 18 Market_Data snapshots",
    authority:
      "Property_Data Overall Market rollup / Market_Data submarket snapshot",
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
