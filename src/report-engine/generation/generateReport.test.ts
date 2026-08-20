import { describe, expect, it, vi } from "vitest";
import { sampleTemplate } from "../../data/sampleTemplate";
import { generateReportInstance } from "./generateReport";

describe("generateReportInstance", () => {
  it("creates an editable, versioned report snapshot through the provider pipeline", async () => {
    const progress = vi.fn();
    const report = await generateReportInstance(
      sampleTemplate,
      {
        templateId: sampleTemplate.id,
        market: "Chicago",
        period: "2026 Q2",
        calculationScope: { type: "all-submarkets" },
        pageSelection: { submarkets: [] },
        source: { provider: "sample" },
      },
      progress,
    );

    expect(report.templateVersion).toBe("1.1.0");
    expect(report.pages).toHaveLength(4);
    expect(report.dataSnapshot.submarkets).toHaveLength(18);
    expect(report.status).toBe("draft");
    expect(progress).toHaveBeenLastCalledWith({
      stage: "complete",
      message: "Report ready to edit and publish",
    });
  });

  it("preserves rotation and checksum-pins managed font faces", async () => {
    const template = structuredClone(sampleTemplate);
    template.assets = [
      {
        id: "nunito-bold",
        name: "Nunito Sans Bold",
        type: "font",
        mimeType: "font/ttf",
        source: "/api/assets/nunito-bold/content",
        createdAt: "2026-08-20T00:00:00.000Z",
        fontFamily: "Nunito Sans",
        fontWeight: 700,
        fontStyle: "normal",
        checksum: "abc123",
        storage: "backend",
      },
    ];
    const report = await generateReportInstance(template, {
      templateId: template.id,
      market: "Chicago",
      period: "2026 Q2",
      calculationScope: { type: "all-submarkets" },
      pageSelection: { submarkets: [] },
      source: { provider: "sample" },
    });
    expect(report.fontReferences).toEqual([
      {
        assetId: "nunito-bold",
        family: "Nunito Sans",
        weight: 700,
        style: "normal",
        checksum: "abc123",
      },
    ]);
    expect(
      report.pages
        .flatMap((page) => page.elements)
        .filter(
          (element) =>
            element.id === "leases-side" || element.id === "sales-side",
        )
        .map((element) => element.rotation),
    ).toEqual([90, 90]);
  });
});
