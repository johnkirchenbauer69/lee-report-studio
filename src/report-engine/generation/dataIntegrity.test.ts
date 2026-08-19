import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { sampleTemplate } from "../../data/sampleTemplate";
import type { ReportTemplate } from "../../types/report";
import { calculateMarketTotals } from "../calculations/marketCalculations";
import { industrialMarketReportSchema } from "../schema/industrialMarketReport";
import type { ReportGenerationRequest } from "../schema/generation";
import { evaluateReportReadiness } from "../validation/reportValidation";
import { generateReportInstance, reconcileSources } from "./generateReport";
import { transitionReportStatus } from "./reportLifecycle";

const request = (
  provider: "sample" | "json" | "excel",
  options: Partial<ReportGenerationRequest> = {},
): ReportGenerationRequest => ({
  templateId: sampleTemplate.id,
  market: "Chicago",
  period: "2026 Q2",
  calculationScope: { type: "all-submarkets" },
  pageSelection: { submarkets: [] },
  source: { provider },
  ...options,
});

const q3Workbook = async () => {
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
    ["Q3 Only Market", 5000, 0, 100, 0.25, -500000, 0.05, 0.08, 9, 0],
  ]);
  return workbook.xlsx.writeBuffer();
};

describe("report data integrity", () => {
  it("prevents cross-quarter fixture contamination in partial Excel reports", async () => {
    const data = await q3Workbook();
    const instance = await generateReportInstance(
      sampleTemplate,
      request("excel", {
        period: "2026 Q3",
        source: {
          provider: "excel",
          configuration: { data, fileName: "q3.xlsx" },
        },
      }),
    );

    expect(instance.dataSnapshot.report.period).toBe("2026 Q3");
    expect(instance.dataSnapshot.submarkets.map((item) => item.name)).toEqual([
      "Q3 Only Market",
    ]);
    expect(instance.dataSnapshot.leasing).toEqual([]);
    expect(instance.dataSnapshot.sales).toEqual([]);
    expect(instance.dataSnapshot.construction).toEqual([]);
    expect(instance.dataSnapshot.overallMarket.narrative).toBe("");
    expect(JSON.stringify(instance.dataSnapshot)).not.toContain(
      "Hyundai Translead",
    );
    const renderedPages = JSON.stringify(instance.pages);
    expect(renderedPages).not.toContain("Hyundai Translead");
    expect(renderedPages).not.toContain("325 State Rt 31");
    expect(renderedPages).not.toContain("chart-net-absorption.png");
    expect(renderedPages).not.toContain("Q2 2026");
    expect(renderedPages).toContain("Q3 2026");
    expect(renderedPages).toContain("Data unavailable: historical periods");
    expect(instance.readiness.canEdit).toBe(true);
    expect(instance.readiness.canPublish).toBe(false);
    expect(instance.readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "dataCompleteness.historicalPeriods",
        }),
      ]),
    );
    expect(() => transitionReportStatus(instance, "published")).toThrow(
      /Cannot publish report/,
    );
  });

  it("blocks request and payload period mismatches", async () => {
    await expect(
      generateReportInstance(
        sampleTemplate,
        request("json", {
          period: "2026 Q3",
          source: {
            provider: "json",
            configuration: { payload: q2SampleReport, fileName: "q2.json" },
          },
        }),
      ),
    ).rejects.toThrow(
      /Requested period 2026 Q3 does not match source period 2026 Q2/,
    );

    const wrongMarket = structuredClone(q2SampleReport);
    wrongMarket.report.market = "Milwaukee";
    await expect(
      generateReportInstance(
        sampleTemplate,
        request("json", {
          source: {
            provider: "json",
            configuration: {
              payload: wrongMarket,
              fileName: "milwaukee.json",
            },
          },
        }),
      ),
    ).rejects.toThrow(
      /Requested market Chicago does not match source market Milwaukee/,
    );
  });

  it("keeps overall calculations independent from detailed page selection", async () => {
    const repeatedTemplate: ReportTemplate = {
      id: "scope-test",
      name: "Scope Test",
      version: "1",
      pages: [
        {
          id: "detail",
          name: "{item} Detail",
          width: 816,
          height: 1056,
          background: "#fff",
          repeat: { sourcePath: "submarkets", contextName: "market" },
          elements: [],
        },
      ],
    };
    const instance = await generateReportInstance(
      repeatedTemplate,
      request("sample", {
        templateId: repeatedTemplate.id,
        pageSelection: { submarkets: ["O'Hare"] },
      }),
    );

    expect(instance.pages).toHaveLength(1);
    expect(instance.pages[0].name).toBe("O'Hare Detail");
    expect(instance.dataSnapshot.overallMarket.inventorySf).toBe(
      calculateMarketTotals(q2SampleReport.submarkets).inventorySf,
    );
    expect(
      instance.dataSnapshot.provenance.find(
        (item) => item.fieldPath === "overallMarket.vacancyRate",
      )?.calculation,
    ).toMatchObject({ inputCount: 18 });

    const selectedScope = await generateReportInstance(
      repeatedTemplate,
      request("sample", {
        templateId: repeatedTemplate.id,
        calculationScope: {
          type: "selected-submarkets",
          submarkets: ["O'Hare"],
        },
        pageSelection: { submarkets: ["I-55 Corridor"] },
      }),
    );
    expect(selectedScope.pages[0].name).toBe("I-55 Corridor Detail");
    expect(selectedScope.dataSnapshot.overallMarket.inventorySf).toBe(
      q2SampleReport.submarkets.find((item) => item.name === "O'Hare")
        ?.inventorySf,
    );
  });

  it("allows drafts but blocks publication for unresolved critical conflicts", () => {
    const report = structuredClone(q2SampleReport);
    report.provenance.push({
      fieldPath: "overallMarket.salesVolume",
      selectedValue: report.overallMarket.salesVolume,
      sources: [
        {
          sourceId: "source-a",
          sourceType: "excel",
          value: 1,
          reference: "A1",
          importedAt: "2026-08-19T00:00:00.000Z",
        },
        {
          sourceId: "source-b",
          sourceType: "json",
          value: 2,
          reference: "$.salesVolume",
          importedAt: "2026-08-19T00:00:00.000Z",
        },
      ],
      authority: "Unresolved",
      status: "conflict",
      critical: true,
      note: "Two authoritative totals disagree.",
    });
    const readiness = evaluateReportReadiness(report, sampleTemplate, "sample");
    expect(readiness.canEdit).toBe(true);
    expect(readiness.canPublish).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "overallMarket.salesVolume" }),
      ]),
    );
  });

  it("resolves a conflict only through an explained authorized override", () => {
    const report = structuredClone(q2SampleReport);
    report.provenance.push({
      fieldPath: "overallMarket.salesVolume",
      selectedValue: report.overallMarket.salesVolume,
      sources: [
        {
          sourceId: "source-a",
          sourceType: "excel",
          value: 1,
          reference: "A1",
          importedAt: "2026-08-19T00:00:00.000Z",
        },
      ],
      authority: "Pending review",
      status: "conflict",
      critical: true,
    });
    report.presentationOverrides.push({
      fieldPath: "overallMarket.salesVolume",
      value: report.overallMarket.salesVolume,
      authority: "Research Director",
      reason: "Approved after source reconciliation.",
      sourceReference: "Reconciliation ticket 42",
      createdAt: "2026-08-19T00:00:00.000Z",
    });
    const reconciled = reconcileSources(report);
    expect(
      reconciled.provenance.find(
        (item) =>
          item.fieldPath === "overallMarket.salesVolume" &&
          item.authority === "Research Director",
      )?.status,
    ).toBe("override");
  });

  it("rejects formatted strings in normalized numeric fields", () => {
    const report = structuredClone(q2SampleReport) as unknown as Record<
      string,
      unknown
    >;
    const submarkets = report.submarkets as Record<string, unknown>[];
    submarkets[0].vacancyRate = "4.96%";
    expect(industrialMarketReportSchema.safeParse(report).success).toBe(false);
  });

  it("requires explained presentation overrides and imported metric provenance", () => {
    const unexplained = structuredClone(q2SampleReport) as unknown as Record<
      string,
      unknown
    >;
    unexplained.presentationOverrides = [
      {
        fieldPath: "overallMarket.vacancyRate",
        value: 0.05,
        authority: "",
        reason: "",
        createdAt: "2026-08-19T00:00:00.000Z",
      },
    ];
    expect(industrialMarketReportSchema.safeParse(unexplained).success).toBe(
      false,
    );

    const untraced = structuredClone(q2SampleReport);
    untraced.provenance = [];
    const readiness = evaluateReportReadiness(untraced, sampleTemplate, "json");
    expect(readiness.canPublish).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "submarkets.Central DuPage.vacancyRate",
        }),
      ]),
    );
  });
});
