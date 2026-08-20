import { MockAscendixReportAdapter } from "../integrations/ascendix/MockAscendixReportAdapter.ts";
import { SalesforceAscendixReportAdapter } from "../integrations/ascendix/SalesforceAscendixReportAdapter.ts";
import { SalesforceRestClient } from "../integrations/salesforce/SalesforceClient.ts";
import {
  getReportDataMode,
  loadSalesforceConfig,
} from "../integrations/salesforce/config.ts";
import { ReportDataService } from "./ReportDataService.ts";
import { InMemoryReportSnapshotStore } from "./reportSnapshots.ts";

export function createReportDataService() {
  const mode = getReportDataMode();
  const adapter =
    mode === "mock"
      ? new MockAscendixReportAdapter()
      : new SalesforceAscendixReportAdapter(
          new SalesforceRestClient(loadSalesforceConfig()),
        );
  return new ReportDataService({
    ascendixAdapter: adapter,
    snapshotStore: new InMemoryReportSnapshotStore(),
    mode,
    logger: (entry) => console.info(JSON.stringify(entry)),
  });
}
