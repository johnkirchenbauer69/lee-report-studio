import path from "node:path";
import { existsSync } from "node:fs";
import { MockAscendixReportAdapter } from "../integrations/ascendix/MockAscendixReportAdapter.ts";
import { SalesforceAscendixReportAdapter } from "../integrations/ascendix/SalesforceAscendixReportAdapter.ts";
import { SalesforceRestClient } from "../integrations/salesforce/SalesforceClient.ts";
import {
  getReportDataMode,
  loadSalesforceConfig,
} from "../integrations/salesforce/config.ts";
import { resolveSalesforceImage } from "../integrations/salesforce/salesforceImageResolver.ts";
import { FileSystemAssetStore } from "../assets/assetStore.ts";
import { SalesforceImageIndex } from "../assets/salesforceImageIndex.ts";
import { ReportDataService } from "./ReportDataService.ts";
import { FileSystemReportSnapshotStore } from "./reportSnapshots.ts";
import { prepareGeographicReport } from "../templates/prepareGeographic.ts";

export function createReportDataService(deps: {
  assetStore?: FileSystemAssetStore;
  dataRoot?: string;
} = {}) {
  const mode = getReportDataMode();
  const dataRoot =
    deps.dataRoot ?? path.resolve(process.env.LEE_DATA_DIR ?? "server/data");
  const assetStore = deps.assetStore ?? new FileSystemAssetStore(dataRoot);
  const imageIndex = new SalesforceImageIndex(dataRoot);
  const basemapRoot = path.resolve(process.env.LEE_GEOGRAPHIC_BASEMAP_ROOT ?? path.join(dataRoot, "geographic-basemaps", "v1"));
  const adapter =
    mode === "mock"
      ? new MockAscendixReportAdapter()
      : (() => {
          const client = new SalesforceRestClient(loadSalesforceConfig());
          return new SalesforceAscendixReportAdapter(
            client,
            undefined,
            (value) =>
              resolveSalesforceImage(value, {
                client,
                assetStore,
                index: imageIndex,
              }),
          );
        })();
  return new ReportDataService({
    ascendixAdapter: adapter,
    snapshotStore: new FileSystemReportSnapshotStore(dataRoot),
    ...(existsSync(path.join(basemapRoot, "display-manifest.json")) ? {
      prepareGeographic: (report: Parameters<typeof prepareGeographicReport>[0], version?: string) =>
        prepareGeographicReport(report, basemapRoot, assetStore, version),
    } : {}),
    mode,
    logger: (entry) => console.info(JSON.stringify(entry)),
  });
}
