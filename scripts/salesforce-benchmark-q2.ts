import "dotenv/config";
import { q2SampleReport } from "../src/data-providers/sample/q2SampleReport.ts";
import { createReportDataService } from "../server/report-data-service/createReportDataService.ts";

if (process.env.REPORT_DATA_MODE !== "salesforce")
  throw new Error(
    "Set REPORT_DATA_MODE=salesforce to run the live Q2 benchmark.",
  );
const result = await createReportDataService().getIndustrialMarketReport({
  reportType: "industrial-market-report",
  market: "Chicago",
  period: "2026 Q2",
  calculationScope: { type: "all-submarkets" },
  timeContext: { type: "historical-period", period: "2026 Q2" },
});
const paths = [
  "inventorySf",
  "deliveredSf",
  "underConstructionSf",
  "speculativeShare",
  "netAbsorptionSf",
  "vacancyRate",
  "availabilityRate",
  "askingNetRentPsf",
  "salesVolume",
] as const;
console.log("Chicago 2026 Q2 live reconciliation");
for (const path of paths) {
  const live = result.report.overallMarket[path];
  const approved = q2SampleReport.overallMarket[path];
  const difference = Math.abs(live - approved);
  const tolerance =
    path.includes("Rate") || path === "speculativeShare"
      ? 0.0001
      : Math.max(1, Math.abs(approved) * 0.000001);
  const provenance = q2SampleReport.provenance.find(
    (item) => item.fieldPath === `overallMarket.${path}`,
  );
  const status =
    difference <= tolerance
      ? "matched"
      : provenance?.status === "override"
        ? "presentation override"
        : Number.isFinite(live)
          ? difference <= tolerance * 10
            ? "rounding difference"
            : "conflict"
          : "missing field";
  console.log(`${path}: ${status}`);
}
console.log(`Snapshot: ${result.snapshot.id} (${result.snapshot.hash})`);
