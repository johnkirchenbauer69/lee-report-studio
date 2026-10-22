import "dotenv/config";
import path from "node:path";
import { createReportDataService } from "../server/report-data-service/createReportDataService.ts";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";

const [outputRoot] = process.argv.slice(2);
if (!outputRoot || process.env.REPORT_DATA_MODE !== "salesforce")
  throw new Error("Expected a new isolated output directory and Salesforce report-data mode");
process.env.LEE_GEOGRAPHIC_BASEMAP_ROOT = path.resolve("server/data/geographic-basemaps/v1");
const service = createReportDataService({ dataRoot: path.resolve(outputRoot),
  assetStore: new FileSystemAssetStore(path.resolve("server/data")) });
const result = await service.getIndustrialMarketReport({
  reportType: "industrial-market-report",
  market: "Chicago",
  period: "2026 Q3",
  timeContext: { type: "historical-period", period: "2026 Q3" },
  calculationScope: { type: "all-submarkets" },
  presentationFamily: "geographic",
});
const report = result.report;
if (report.submarketDetails.length !== 18 || !report.overallActivityMapAssetUrl || !report.overallActivityMapChecksum)
  throw new Error("Incomplete Geographic Q3 snapshot: submarkets or overall map missing");
console.log(JSON.stringify({ snapshotId: result.sourceMetadata.snapshotId,
  submarkets: report.submarketDetails.length,
  featuredListings: report.submarketDetails.filter(row => row.featuredAvailability?.status === "selected").length,
  featuredDeals: report.submarketDetails.filter(row => row.featuredDeal?.status === "selected").length,
  overallFeaturedAvailability: report.overallFeaturedAvailability?.status,
  overallFeaturedDeal: report.overallFeaturedDeal?.status,
  overallMapChecksum: report.overallActivityMapChecksum,
  recordCounts: result.sourceMetadata.recordCounts }));
