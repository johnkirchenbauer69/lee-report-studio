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
        templateVersion: sampleTemplate.version,
        market: "Chicago",
        period: "2026 Q2",
        calculationScope: { type: "all-submarkets" },
        pageSelection: { submarkets: [] },
        source: { provider: "sample" },
      },
      progress,
    );

    expect(report.templateVersion).toBe("1.3.0");
    expect(report.templateChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(report.pages).toHaveLength(8);
    expect(report.dataSnapshot.submarkets).toHaveLength(18);
    expect(report.status).toBe("draft");
    expect(progress).toHaveBeenLastCalledWith({
      stage: "complete",
      message: "Report ready to edit and publish",
    });
  });

  it("pins generation to the explicitly requested template version", async () => {
    await expect(
      generateReportInstance(sampleTemplate, {
        templateId: sampleTemplate.id,
        templateVersion: "99.0.0",
        market: "Chicago",
        period: "2026 Q2",
        calculationScope: { type: "all-submarkets" },
        pageSelection: {},
        source: { provider: "sample" },
      }),
    ).rejects.toThrow("does not match loaded template");
  });

  it("rejects a request whose stored checksum does not match the loaded version", async () => {
    await expect(
      generateReportInstance(sampleTemplate, {
        templateId: sampleTemplate.id,
        templateVersion: sampleTemplate.version,
        templateChecksum: "0".repeat(64),
        market: "Chicago",
        period: "2026 Q2",
        calculationScope: { type: "all-submarkets" },
        pageSelection: {},
        source: { provider: "sample" },
      }),
    ).rejects.toThrow("does not match loaded template checksum");
  });

  it("isolates generated report edits from the master and later master edits from history", async () => {
    const master = structuredClone(sampleTemplate);
    const report = await generateReportInstance(master, {
      templateId: master.id,
      templateVersion: master.version,
      market: "Chicago",
      period: "2026 Q2",
      calculationScope: { type: "all-submarkets" },
      pageSelection: {},
      source: { provider: "sample" },
    });
    const originalMasterName = master.pages[0]!.name;
    report.pages[0]!.name = "Edited Q2 report page";
    expect(master.pages[0]!.name).toBe(originalMasterName);
    master.pages[0]!.name = "Future master page";
    expect(report.pages[0]!.name).toBe("Edited Q2 report page");
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
      templateVersion: template.version,
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

  it("pins every managed text element across repeated pages and dynamic labels", async () => {
    const template = structuredClone(sampleTemplate);
    template.assets = [
      {
        id: "nunito-semibold",
        name: "Nunito Sans SemiBold",
        type: "font",
        mimeType: "font/ttf",
        source: "/api/assets/nunito-semibold/content",
        createdAt: "2026-08-27T00:00:00.000Z",
        fontFamily: "Nunito Sans",
        fontWeight: 600,
        fontStyle: "normal",
        checksum: "semibold-checksum",
        version: 1,
        storage: "backend",
      },
    ];
    const report = await generateReportInstance(template, {
      templateId: template.id,
      templateVersion: template.version,
      market: "Chicago",
      period: "2026 Q2",
      calculationScope: { type: "all-submarkets" },
      pageSelection: {},
      source: { provider: "sample" },
    });
    const textElements = report.pages
      .flatMap((page) => page.elements)
      .filter((element) => element.type === "text");
    expect(report.pages).toHaveLength(44);
    expect(
      textElements.some(
        (element) => element.name === "Quarter" && element.text === "Q2 2026",
      ),
    ).toBe(true);
    expect(
      textElements.every(
        (element) =>
          element.style.typography?.fontAssetId === "nunito-semibold" &&
          element.style.typography?.fontChecksum === "semibold-checksum",
      ),
    ).toBe(true);
  });
});
