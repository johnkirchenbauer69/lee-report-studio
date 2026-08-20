import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createReportDataRouter } from "../api/reportDataRoutes.ts";
import { MockAscendixReportAdapter } from "../integrations/ascendix/MockAscendixReportAdapter.ts";
import { ReportMcpTools } from "../mcp/tools/reportTools.ts";
import { ReportDataService } from "./ReportDataService.ts";
import { InMemoryReportSnapshotStore } from "./reportSnapshots.ts";

const request = {
  reportType: "industrial-market-report" as const,
  market: "Chicago",
  period: "2026 Q2",
  calculationScope: { type: "all-submarkets" as const },
};

describe("HTTP and MCP report data parity", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it("returns the same normalized snapshot hash through both interfaces", async () => {
    const service = new ReportDataService({
      ascendixAdapter: new MockAscendixReportAdapter(),
      snapshotStore: new InMemoryReportSnapshotStore(),
      mode: "mock",
      now: () => new Date("2026-08-20T12:00:00.000Z"),
    });
    const app = express();
    app.use(express.json());
    app.use("/api", createReportDataRouter(service));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind.");
    const httpResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/report-data/industrial-market`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    const httpResult = (await httpResponse.json()) as {
      snapshot: { hash: string };
      report: unknown;
    };
    const mcpResult = await new ReportMcpTools(service).getMarketReportData(
      request,
    );
    expect(httpResponse.status).toBe(200);
    expect(mcpResult.snapshot.hash).toBe(httpResult.snapshot.hash);
    expect(mcpResult.report).toEqual(httpResult.report);
    expect(mcpResult.summary).toMatchObject({
      quarterlyNetAbsorptionSf: 5_206_811,
      trailing12MonthNetAbsorptionSf: 17_654_829,
    });
  });

  it("calculates a selected-submarket scope without reusing the full-market aggregate", async () => {
    const service = new ReportDataService({
      ascendixAdapter: new MockAscendixReportAdapter(),
      snapshotStore: new InMemoryReportSnapshotStore(),
      mode: "mock",
    });
    const result = await service.getIndustrialMarketReport({
      ...request,
      calculationScope: {
        type: "selected-submarkets",
        submarkets: ["Central DuPage"],
      },
    });
    expect(result.report.overallMarket.inventorySf).toBe(21_350_998);
    expect(
      result.report.provenance.find(
        (item) => item.fieldPath === "overallMarket.inventorySf",
      ),
    ).toMatchObject({
      selectedValue: 21_350_998,
      status: "calculated",
      authority: "LEE Report Studio calculation engine",
    });
  });
});
