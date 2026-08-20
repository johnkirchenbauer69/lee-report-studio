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
  "industrial-market-report-data-v4-explicit-absorption-periods";

export const industrialMarketMetricDefinitions: readonly MetricDefinition[] = [
  {
    metricPath: "overallMarket.quarterlyNetAbsorptionSf",
    version: "v1",
    sourceObject: "Property_Data__c",
    sourceField: "Net_Absorption_SF_Total__c",
    calculation:
      "Current report-quarter signed sum across the eligible 20K+ Property_Data universe and accepted submarkets.",
    authority: "Property_Data__c Overall Market current-quarter rollup",
    timeContext: "historical-period",
  },
  {
    metricPath: "submarkets.*.quarterlyNetAbsorptionSf",
    version: "v1",
    sourceObject: "Market_Data__c",
    sourceField: "Total_Net_Absorption_SF__c",
    calculation: "Official selected-quarter submarket value.",
    authority: "Market_Data__c official submarket snapshot",
    timeContext: "historical-period",
  },
  {
    metricPath: "historicalPeriods.*.trailing12MonthNetAbsorptionSf",
    version: "v1",
    sourceObject: "Market_Data__c",
    sourceField: "Total_Net_Absorption_SF__c",
    calculation:
      "Signed sum of quarterlyNetAbsorptionSf for the target quarter and immediately preceding three quarters; null when history is incomplete.",
    authority: "verified-derived trailing four-quarter calculation",
    timeContext: "historical-period",
  },
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
