import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ReportGenerationRequest } from "../report-engine/schema/generation";
import { ExcelDataProvider } from "./excel/ExcelDataProvider";
import { JsonDataProvider } from "./json/JsonDataProvider";
import { q2SampleReport } from "./sample/q2SampleReport";

const request = (
  provider: "json" | "excel",
  configuration: unknown,
): ReportGenerationRequest => ({
  templateId: "industrial-market-report",
  market: "Chicago",
  period: "2026 Q2",
  source: { provider, configuration },
});

describe("report data providers", () => {
  it("loads a validated normalized JSON payload", async () =>
    expect(
      (
        await new JsonDataProvider().loadReportData(
          request("json", { payload: JSON.stringify(q2SampleReport) }),
        )
      ).submarkets,
    ).toHaveLength(18));
  it("returns actionable JSON validation errors", async () =>
    await expect(
      new JsonDataProvider().loadReportData(
        request("json", { payload: '{"report":{}}' }),
      ),
    ).rejects.toMatchObject({
      message: "Import failed.",
      issues: expect.arrayContaining([
        expect.stringContaining("overallMarket"),
      ]),
    }));
  it("maps the supported workbook through a source DTO instead of UI cell references", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Submarket Table");
    sheet.addRows([
      [
        "Submarket",
        "Inventory (SF)",
        "Delivered (SF)",
        "Under Construction (SF)",
        "Construction Speculative (%)",
        "Net Absorption (SF)",
        "Total Vacant (%)",
        "Total Available (%)",
        "Asking Net Rent ($/SF)",
        "Sales Volume ($)",
      ],
      ["Test Market", 1000, 10, 20, 0.5, -25, 0.1, 0.2, 9.5, 1000000],
    ]);
    const data = await workbook.xlsx.writeBuffer();
    const report = await new ExcelDataProvider().loadReportData(
      request("excel", { data, fileName: "test.xlsx" }),
    );
    expect(report.submarkets[0]).toMatchObject({
      name: "Test Market",
      inventorySf: 1000,
      netAbsorptionSf: -25,
    });
    expect(report.provenance).toContainEqual(
      expect.objectContaining({
        fieldPath: "submarkets.Test Market.inventorySf",
        sources: [expect.objectContaining({ reference: "Submarket Table!B2" })],
      }),
    );
  });
});
