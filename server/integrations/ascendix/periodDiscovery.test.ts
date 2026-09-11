import { describe, expect, it } from "vitest";
import { CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS } from "../../../src/report-engine/submarkets.ts";
import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { salesforceFieldMap as mapping } from "./salesforceFieldMap.ts";
import {
  reportablePeriodsFromMarketData,
  reportPeriodDiscoveryQuery,
  reportPeriodMetricFields,
} from "./periodDiscovery.ts";

const md = mapping.marketData;
const rowsFor = (
  label: string,
  periodEnd: string,
  count = CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.length,
) =>
  CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.slice(0, count).map(
    (submarket, index): SalesforceRecord => ({
      Id: `${label}-${index}`,
      [md.period.apiName]: label,
      [md.periodEnd.apiName]: periodEnd,
      [md.submarket.apiName]: submarket,
      [md.submarketCode.apiName]: `code-${index}`,
      ...Object.fromEntries(
        reportPeriodMetricFields.map((field) => [field.apiName, 1]),
      ),
    }),
  );

describe("Market_Data report period discovery", () => {
  it("returns complete Q3 and sorts periods newest by Period_End__c", () => {
    const q3 = rowsFor("2026 Q3", "2026-09-30");
    q3[0]![md.askingNetRentPsf.apiName] = null;
    const periods = reportablePeriodsFromMarketData([
      ...rowsFor("2025 Q4", "2025-12-31"),
      ...q3,
      ...rowsFor("2026 Q1", "2026-03-31"),
      ...rowsFor("2026 Q2", "2026-06-30"),
    ]);
    expect(periods.map((period) => period.label)).toEqual([
      "2026 Q3",
      "2026 Q2",
      "2026 Q1",
      "2025 Q4",
    ]);
    expect(periods[0]).toEqual({
      label: "2026 Q3",
      periodEnd: "2026-09-30",
      submarketCount: 18,
    });
  });

  it("allows a future-dated period when rows exist and never synthesizes one", () => {
    expect(
      reportablePeriodsFromMarketData(rowsFor("2099 Q1", "2099-03-31")),
    ).toEqual([
      { label: "2099 Q1", periodEnd: "2099-03-31", submarketCount: 18 },
    ]);
    expect(
      reportablePeriodsFromMarketData(rowsFor("2026 Q3", "2026-09-30")).map(
        (period) => period.label,
      ),
    ).not.toContain("2026 Q4");
  });

  it("deduplicates rows without duplicating the period option", () => {
    const rows = rowsFor("2026 Q3", "2026-09-30");
    expect(reportablePeriodsFromMarketData([...rows, rows[0]!])).toHaveLength(
      1,
    );
  });

  it("excludes a 17-submarket or metric-incomplete snapshot", () => {
    const incompleteMetrics = rowsFor("2026 Q2", "2026-06-30");
    incompleteMetrics[0]![md.inventorySf.apiName] = null;
    expect(
      reportablePeriodsFromMarketData([
        ...rowsFor("2026 Q3", "2026-09-30", 17),
        ...incompleteMetrics,
      ]),
    ).toEqual([]);
  });

  it("limits the selector to the newest eight quarters", () => {
    const rows = [
      ["2026 Q3", "2026-09-30"],
      ["2026 Q2", "2026-06-30"],
      ["2026 Q1", "2026-03-31"],
      ["2025 Q4", "2025-12-31"],
      ["2025 Q3", "2025-09-30"],
      ["2025 Q2", "2025-06-30"],
      ["2025 Q1", "2025-03-31"],
      ["2024 Q4", "2024-12-31"],
      ["2024 Q3", "2024-09-30"],
    ].flatMap(([label, end]) => rowsFor(label!, end!));
    expect(reportablePeriodsFromMarketData(rows)).toHaveLength(8);
    expect(reportablePeriodsFromMarketData(rows).at(-1)?.label).toBe("2024 Q4");
  });

  it("queries only the canonical period/geography identity and required metrics", () => {
    const query = reportPeriodDiscoveryQuery();
    expect(query).toContain("Period_End__c");
    expect(query).toContain("Quarter_Label__c");
    expect(query).toContain("Submarket__c");
    expect(query).toContain("Submarket_Code__c");
    expect(query).not.toContain("Market__c");
    expect(query).not.toContain("Period_Type__c");
    expect(query).not.toContain("Quarter__c");
    expect(query).not.toContain("Year__c");
  });
});
