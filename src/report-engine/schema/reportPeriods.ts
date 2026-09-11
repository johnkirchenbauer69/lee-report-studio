export interface ReportPeriodOption {
  label: string;
  periodEnd: string;
  submarketCount: number;
}

export interface ReportPeriodsResponse {
  periods: ReportPeriodOption[];
  mode: "mock" | "salesforce";
  requiredSubmarketCount: number;
  generatedAt: string;
}
