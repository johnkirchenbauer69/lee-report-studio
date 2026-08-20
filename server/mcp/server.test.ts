import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { MockAscendixReportAdapter } from "../integrations/ascendix/MockAscendixReportAdapter.ts";
import { ReportDataService } from "../report-data-service/ReportDataService.ts";
import { InMemoryReportSnapshotStore } from "../report-data-service/reportSnapshots.ts";
import { createReportMcpHandler } from "./server.ts";

describe("MCP Streamable HTTP server", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it("negotiates MCP and exposes semantic report tools only", async () => {
    const service = new ReportDataService({
      ascendixAdapter: new MockAscendixReportAdapter(),
      snapshotStore: new InMemoryReportSnapshotStore(),
      mode: "mock",
    });
    const app = express();
    app.all("/mcp", createReportMcpHandler(service));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("MCP test server did not bind.");
    const endpoint = `http://127.0.0.1:${address.port}/mcp`;
    const headers = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };
    const initialized = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "integration-test", version: "1.0.0" },
        },
      }),
    });
    expect(await initialized.text()).toContain("lee-report-studio");
    const listed = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    const tools = await listed.text();
    expect(tools).toContain("get_market_report_data");
    expect(tools).toContain("get_report_provenance");
    expect(tools).not.toContain("run_soql");
    expect(tools).not.toContain("execute_apex");
  });
});
