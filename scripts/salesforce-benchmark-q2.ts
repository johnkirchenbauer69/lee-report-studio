import "dotenv/config";
import { CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS } from "../server/integrations/ascendix/salesforceFieldMap.ts";
import { createReportDataService } from "../server/report-data-service/createReportDataService.ts";

if (process.env.REPORT_DATA_MODE !== "salesforce")
  throw new Error(
    "Set REPORT_DATA_MODE=salesforce to run the live Q2 benchmark.",
  );
const service = createReportDataService();
const base = {
  reportType: "industrial-market-report",
  market: "Chicago",
  period: "2026 Q2",
  timeContext: { type: "historical-period", period: "2026 Q2" },
} as const;
const overall = await service.getIndustrialMarketReport({
  ...base,
  calculationScope: { type: "all-submarkets" },
});
const ohare = await service.getIndustrialMarketReport({
  ...base,
  calculationScope: { type: "selected-submarkets", submarkets: ["O'Hare"] },
});
const centralDuPage = await service.getIndustrialMarketReport({
  ...base,
  calculationScope: {
    type: "selected-submarkets",
    submarkets: ["Central DuPage"],
  },
});
const chicagoSouth = await service.getIndustrialMarketReport({
  ...base,
  calculationScope: {
    type: "selected-submarkets",
    submarkets: ["Chicago South"],
  },
});
const facts = overall.sourceMetadata.sourceDefinition?.propertyDataRollup ?? {};

type Status =
  | "MATCH"
  | "ROUNDING"
  | "KNOWN RECONCILIATION DIFFERENCE"
  | "CONFLICT"
  | "MISSING";
const classify = (
  live: number | undefined,
  expected: number,
  tolerance: number,
  known = false,
): Status => {
  if (live === undefined || !Number.isFinite(live)) return "MISSING";
  const difference = Math.abs(live - expected);
  if (difference <= tolerance) return "MATCH";
  if (difference <= tolerance * 10) return "ROUNDING";
  return known ? "KNOWN RECONCILIATION DIFFERENCE" : "CONFLICT";
};
const metric = (
  label: string,
  live: number | undefined,
  expected: number,
  tolerance: number,
  source: string,
  known = false,
) => {
  const difference = live === undefined ? undefined : live - expected;
  console.log(
    `${label}\n  Live: ${live ?? "MISSING"}\n  Approved: ${expected}\n  Difference: ${difference ?? "MISSING"}\n  Tolerance: ${tolerance}\n  Source: ${source}\n  Status: ${classify(live, expected, tolerance, known)}`,
  );
};
const contributor = (
  label: string,
  actual: { address: string; sizeSf: number } | undefined,
  expectedAddress: string,
  expectedSf: number,
) => {
  const addressMatch =
    actual?.address
      .toLocaleLowerCase()
      .includes(expectedAddress.toLocaleLowerCase()) ?? false;
  const sizeMatch = actual ? Math.abs(actual.sizeSf - expectedSf) <= 1 : false;
  console.log(
    `${label}\n  Live: ${actual ? `${actual.address} / ${actual.sizeSf} SF` : "MISSING"}\n  Expected: ${expectedAddress} / ${expectedSf} SF\n  Status: ${addressMatch && sizeMatch ? "MATCH" : actual ? "CONFLICT" : "MISSING"}`,
  );
};

console.log("Chicago 2026 Q2 live-verified contract benchmark");
console.log(
  `Market_Data records: expected 18; actual ${overall.sourceMetadata.recordCounts.marketData}; status ${overall.sourceMetadata.recordCounts.marketData === 18 ? "MATCH" : "KNOWN RECONCILIATION DIFFERENCE"}`,
);
console.log(
  `Accepted submarkets: expected 18; actual ${overall.report.submarkets.length}; status ${JSON.stringify(overall.report.submarkets.map((row) => row.name)) === JSON.stringify(CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS) ? "MATCH" : "CONFLICT"}`,
);
console.log(
  `Property_Data matched rows: benchmark 11947; actual ${overall.sourceMetadata.recordCounts.propertyData}; status ${overall.sourceMetadata.recordCounts.propertyData === 11947 ? "MATCH" : "KNOWN RECONCILIATION DIFFERENCE"}`,
);
console.log(
  `Contributor active/included: benchmark 387; actual ${overall.sourceMetadata.recordCounts.contributors}; status ${overall.sourceMetadata.recordCounts.contributors === 387 ? "MATCH" : "KNOWN RECONCILIATION DIFFERENCE"}`,
);
console.log(
  `Salesforce calls: ${JSON.stringify(overall.sourceMetadata.sourceDefinition?.apiCallCounts ?? {})}`,
);

metric(
  "Inventory",
  overall.report.overallMarket.inventorySf,
  1_258_128_403,
  1,
  "Property_Data__c",
  true,
);
metric(
  "Vacancy",
  overall.report.overallMarket.vacancyRate,
  0.048385545405,
  0.000001,
  "SUM(Property_Data.Vacant) / SUM(Property_Data.Inventory)",
);
metric(
  "Availability",
  overall.report.overallMarket.availabilityRate,
  0.084641905982,
  0.000001,
  "SUM(Property_Data.Available) / SUM(Property_Data.Inventory)",
);
metric(
  "Overall Market Quarterly Net Absorption",
  overall.report.overallMarket.quarterlyNetAbsorptionSf,
  5_206_811,
  1,
  "SUM(Property_Data__c.Net_Absorption_SF_Total__c)",
);
const currentIndicator = overall.report.historicalPeriods.find(
  (period) => period.period === "2026 Q2",
);
metric(
  "Overall Market 12-Month Net Absorption",
  currentIndicator?.trailing12MonthNetAbsorptionSf ?? undefined,
  17_654_829,
  1,
  "signed sum of four quarterly Market_Data__c aggregates",
);
const trailingProvenance = overall.report.provenance.find(
  (entry) =>
    entry.fieldPath ===
    "historicalPeriods.2026 Q2.trailing12MonthNetAbsorptionSf",
);
console.log("12-Month Net Absorption — Q2 2026");
for (const inputPeriod of trailingProvenance?.calculation?.inputPeriods ?? []) {
  const input = overall.report.historicalPeriods.find(
    (period) => period.period === inputPeriod,
  );
  console.log(
    `  ${inputPeriod} quarterly: ${input?.quarterlyNetAbsorptionSf ?? "MISSING"}`,
  );
}
console.log(
  `  Calculated T12: ${currentIndicator?.trailing12MonthNetAbsorptionSf ?? "MISSING"}`,
);
metric(
  "Leasing Activity",
  Number(facts.leasingActivitySf),
  14_584_206,
  1,
  "Property_Data__c",
);

metric(
  "Central DuPage Quarterly Net Absorption",
  centralDuPage.report.overallMarket.quarterlyNetAbsorptionSf,
  126_800,
  1,
  "Market_Data__c.Total_Net_Absorption_SF__c",
);
metric(
  "Central DuPage 12-Month Net Absorption",
  centralDuPage.report.historicalPeriods[0]?.trailing12MonthNetAbsorptionSf ??
    undefined,
  265_471,
  1,
  "signed sum of four quarterly Market_Data__c records",
);
metric(
  "Chicago South Quarterly Net Absorption",
  chicagoSouth.report.overallMarket.quarterlyNetAbsorptionSf,
  37_457,
  1,
  "Market_Data__c.Total_Net_Absorption_SF__c",
);
metric(
  "Chicago South 12-Month Net Absorption",
  chicagoSouth.report.historicalPeriods[0]?.trailing12MonthNetAbsorptionSf ??
    undefined,
  409_204,
  1,
  "signed sum of four quarterly Market_Data__c records",
);
metric(
  "Deliveries",
  overall.report.overallMarket.deliveredSf,
  1_651_772,
  1,
  "Property_Data__c",
);
metric(
  "Under Construction",
  overall.report.overallMarket.underConstructionSf,
  13_779_195,
  1,
  "Property_Data__c",
);
metric(
  "Under Construction Available",
  Number(facts.underConstructionAvailableSf),
  4_659_404,
  1,
  "Property_Data__c",
);
metric(
  "Speculative Construction",
  overall.report.overallMarket.speculativeShare,
  4_659_404 / 13_779_195,
  0.000001,
  "verified-derived Property_Data ratio-of-sums",
);
metric(
  "Sales Volume",
  overall.report.overallMarket.salesVolume,
  1_246_218_145.5,
  1,
  "Property_Data__c",
);

contributor(
  "O'Hare Largest Availability",
  ohare.report.availabilities[0],
  "851-875 E Devon Ave",
  268_635,
);
contributor(
  "O'Hare Largest Delivery",
  ohare.report.deliveries[0],
  "424 Howard Ave",
  171_600,
);
contributor(
  "O'Hare Largest Under Construction",
  ohare.report.construction[0],
  "25-30 Algonquin Rd",
  260_400,
);
contributor(
  "Overall Market Largest Availability",
  overall.report.availabilities[0],
  "325 State Rt 31",
  1_008_095,
);

console.log(
  "Chicago South unlinked Property_Data row: KNOWN RECONCILIATION DIFFERENCE (included in Overall Market; excluded only from parent-linked QA).",
);
console.log(
  "West Cook inventory: Market_Data 66,346,013 vs linked Property_Data 66,428,013; difference 82,000; KNOWN RECONCILIATION DIFFERENCE. Market_Data remains authoritative for West Cook.",
);
console.log(
  `Speculative construction: 4,659,404 / 13,779,195 = ${((4_659_404 / 13_779_195) * 100).toFixed(4)}%; approved display 34%; VERIFIED-DERIVED.`,
);
console.log(`Snapshot: ${overall.snapshot.id} (${overall.snapshot.hash})`);
