import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportGenerationRequest } from "../report-engine/schema/generation";
import { AscendixDataProvider } from "./ascendix/AscendixDataProvider";
import { ExcelDataProvider } from "./excel/ExcelDataProvider";
import { JsonDataProvider } from "./json/JsonDataProvider";
import { q2SampleReport } from "./sample/q2SampleReport";

const request = (
  provider: "json" | "excel" | "ascendix",
  configuration?: unknown,
  period = "2026 Q2",
): ReportGenerationRequest => ({
  templateId: "industrial-market-report",
  market: "Chicago",
  period,
  calculationScope: { type: "all-submarkets" },
  pageSelection: { submarkets: [] },
  source: { provider, configuration },
});

const workbookBytes = async (
  values: [
    string,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ],
) => {
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
    values,
  ]);
  return workbook.xlsx.writeBuffer();
};

describe("report data providers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads only the explicitly supplied normalized JSON payload", async () => {
    const result = await new JsonDataProvider().loadReportData(
      request("json", {
        payload: JSON.stringify(q2SampleReport),
        fileName: "explicit-q2.json",
      }),
    );
    expect(result.report.submarkets).toHaveLength(18);
    expect(result.provider).toBe("json");
    expect(result.sourceMetadata.sourceName).toBe("explicit-q2.json");
  });

  it("returns business-readable JSON validation errors", async () => {
    const invalid = structuredClone(q2SampleReport);
    invalid.submarkets[4].vacancyRate = 1.45;
    await expect(
      new JsonDataProvider().loadReportData(
        request("json", { payload: invalid, fileName: "invalid.json" }),
      ),
    ).rejects.toMatchObject({
      message: "Import failed.",
      issues: expect.arrayContaining([
        expect.stringContaining("I-57 Corridor — Vacancy Rate"),
        expect.stringContaining("Expected: 0% to 100%"),
      ]),
    });
  });

  it("maps Excel cells with provenance and leaves absent sections missing", async () => {
    const data = await workbookBytes([
      "Test Market",
      1000,
      10,
      20,
      0.5,
      -25,
      0.1,
      0.2,
      9.5,
      1000000,
    ]);
    const result = await new ExcelDataProvider().loadReportData(
      request("excel", { data, fileName: "q3.xlsx" }, "2026 Q3"),
    );
    expect(result.report.submarkets[0]).toMatchObject({
      name: "Test Market",
      inventorySf: 1000,
      quarterlyNetAbsorptionSf: -25,
    });
    expect(result.report.leasing).toEqual([]);
    expect(result.report.sales).toEqual([]);
    expect(result.report.construction).toEqual([]);
    expect(result.completeness).toContainEqual(
      expect.objectContaining({ section: "leasing", status: "missing" }),
    );
    expect(result.report.provenance).toContainEqual(
      expect.objectContaining({
        fieldPath: "submarkets.Test Market.inventorySf",
        sources: [
          expect.objectContaining({
            reference: "Submarket Table!B2",
            importedAt: expect.any(String),
          }),
        ],
      }),
    );
    expect(JSON.stringify(result.report)).not.toContain("Hyundai Translead");
    expect(JSON.stringify(result.report)).not.toContain(
      "Realty Income Corporation",
    );
  });

  it("accepts negative absorption but rejects out-of-range rates", async () => {
    const valid = await workbookBytes([
      "Negative Absorption",
      1000,
      0,
      0,
      0,
      -500000,
      0.1,
      0.2,
      8,
      0,
    ]);
    await expect(
      new ExcelDataProvider().loadReportData(
        request("excel", { data: valid, fileName: "valid.xlsx" }),
      ),
    ).resolves.toMatchObject({
      report: {
        submarkets: [
          expect.objectContaining({ quarterlyNetAbsorptionSf: -500000 }),
        ],
      },
    });

    const invalid = await workbookBytes([
      "Invalid Rate",
      1000,
      0,
      0,
      0,
      0,
      1.45,
      0.2,
      8,
      0,
    ]);
    await expect(
      new ExcelDataProvider().loadReportData(
        request("excel", { data: invalid, fileName: "invalid.xlsx" }),
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.stringContaining("Invalid Rate — Vacancy Rate"),
      ]),
    });
  });

  it("uses only the authenticated Ascendix response", async () => {
    const payload = structuredClone(q2SampleReport) as unknown as Record<
      string,
      unknown
    >;
    const report = payload.report as Record<string, unknown>;
    report.period = "2026 Q3";
    payload.leasing = [];
    payload.sales = [];
    payload.availabilities = [];
    payload.deliveries = [];
    payload.construction = [];
    payload.historicalPeriods = [];
    payload.provenance = [];
    payload.presentationOverrides = [];
    payload.dataCompleteness = [];
    (payload.overallMarket as Record<string, unknown>).narrative = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            report: payload,
            sourceMetadata: {
              generatedAt: "2026-08-20T12:00:00.000Z",
              reportDefinitionVersion: "industrial-market-report-data-v1",
            },
            completeness: [],
            snapshot: { id: "snapshot-test", hash: "abc123" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const result = await new AscendixDataProvider("/secure").loadReportData(
      request("ascendix", undefined, "2026 Q3"),
    );
    expect(result.report.report.period).toBe("2026 Q3");
    expect(result.report.leasing).toEqual([]);
    expect(result.snapshot).toMatchObject({
      id: "snapshot-test",
      hash: "abc123",
    });
    expect(JSON.stringify(result.report)).not.toContain("Hyundai Translead");
  });
});
