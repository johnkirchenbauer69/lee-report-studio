import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { RequestHandler } from "express";
import type { ReportDataService } from "../report-data-service/ReportDataService.ts";
import { reportDataRequestSchema } from "../report-data-service/contracts.ts";
import {
  provenanceInputSchema,
  ReportMcpTools,
  snapshotIdSchema,
} from "./tools/reportTools.ts";

const response = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

export function createReportMcpHandler(
  service: ReportDataService,
): RequestHandler {
  const handler = createMcpHandler(() => {
    const tools = new ReportMcpTools(service);
    const server = new McpServer(
      { name: "lee-report-studio", version: "1.0.0" },
      {
        instructions:
          "Use these semantic tools for authoritative market-report data. Do not independently calculate official metrics or request raw Salesforce access.",
      },
    );
    server.registerTool(
      "get_market_report_data",
      {
        description:
          "Retrieve validated normalized market-report data from the authoritative LEE Report Data Service. Use this instead of independently calculating report metrics from raw Salesforce records.",
        inputSchema: reportDataRequestSchema,
      },
      async (input) => response(await tools.getMarketReportData(input)),
    );
    server.registerTool(
      "validate_report",
      {
        description:
          "Evaluate deterministic publication readiness, missing sections, and unresolved conflicts for an immutable report snapshot.",
        inputSchema: snapshotIdSchema,
      },
      async (input) => response(await tools.validateReport(input)),
    );
    server.registerTool(
      "get_report_conflicts",
      {
        description:
          "Inspect structured conflicting, reconciled, or overridden source values already recorded in a report snapshot.",
        inputSchema: snapshotIdSchema,
      },
      async (input) => response(await tools.getReportConflicts(input)),
    );
    server.registerTool(
      "get_report_provenance",
      {
        description:
          "Inspect the selected value, Salesforce source records, calculation lineage, authority, and overrides for one field in a report snapshot.",
        inputSchema: provenanceInputSchema,
      },
      async (input) => response(await tools.getReportProvenance(input)),
    );
    server.registerTool(
      "get_report_service_status",
      {
        description:
          "Return safe Report Data Service capabilities, mode, connectivity, and definition version without exposing credentials.",
      },
      async () => response(await tools.getReportServiceStatus()),
    );
    return server;
  });
  const nodeHandler = toNodeHandler(handler);
  return ((request, response) => {
    void nodeHandler(request, response);
  }) as RequestHandler;
}

export const requireMcpAuthentication: RequestHandler = (
  request,
  response,
  next,
) => {
  const expected = process.env.MCP_API_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      response
        .status(503)
        .json({ error: "MCP authentication is not configured." });
      return;
    }
    next();
    return;
  }
  if (request.headers.authorization !== `Bearer ${expected}`) {
    response.status(401).json({ error: "MCP authentication failed." });
    return;
  }
  next();
};
