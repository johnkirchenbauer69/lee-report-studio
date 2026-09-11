import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import type { ReportPage } from "../../src/types/report";
import type { StoredTemplateVersion } from "../../src/types/templateLibrary";
import {
  AssetReferenceIndex,
  assetDependencyCount,
  collectPageAssetReferences,
} from "./assetReferences";

const page = (assetId: string): ReportPage => ({
  id: `page-${assetId}`,
  name: "Asset references",
  width: 816,
  height: 1056,
  background: `url(/api/assets/${assetId}-background/content)`,
  elements: [
    {
      id: `image-${assetId}`,
      name: "Image",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      src: `/api/assets/${assetId}/content`,
      assetId,
      style: {},
    },
    {
      id: `table-${assetId}`,
      name: "Table",
      type: "table",
      x: 0,
      y: 100,
      width: 100,
      height: 100,
      sourcePath: "rows",
      columns: [
        {
          key: "value",
          label: "Value",
          path: "value",
          headerStyle: { fontAssetId: `${assetId}-nested-font` },
        },
      ],
      style: {},
    },
  ],
});

const record = (
  status: StoredTemplateVersion["status"],
  version: string,
  pages: ReportPage[],
) =>
  ({
    id: "industrial-market-report",
    name: "Industrial Market Report",
    templateType: "industrial-market-report",
    version,
    status,
    createdAt: "2026-09-09T10:00:00.000Z",
    updatedAt: "2026-09-09T10:00:00.000Z",
    checksum: `checksum-${version}`,
    pageDefinitionCount: pages.length,
    revision: 1,
    template: { ...structuredClone(sampleTemplate), version, pages },
    assetReferences: [],
    managedFontReferences: [],
  }) satisfies StoredTemplateVersion;

describe("asset reference indexing", () => {
  it("finds image URLs, explicit IDs, page backgrounds, and nested fonts", () => {
    expect([...collectPageAssetReferences([page("asset-one")])].sort()).toEqual(
      ["asset-one", "asset-one-background", "asset-one-nested-font"].sort(),
    );
  });

  it("reports every persisted artifact that references one asset", async () => {
    const report = await generateReportInstance(sampleTemplate, {
      templateId: sampleTemplate.id,
      templateVersion: sampleTemplate.version,
      market: "Chicago",
      period: "2026 Q2",
      calculationScope: { type: "all-submarkets" },
      pageSelection: { submarketIds: [] },
      source: { provider: "sample" },
    });
    report.pages = [page("shared")];
    report.fontReferences = [
      {
        assetId: "shared",
        family: "Nunito Sans",
        weight: 400,
        style: "normal",
        checksum: "checksum",
      },
    ];
    const index = new AssetReferenceIndex(
      {
        listAll: async () => [
          record("draft", "1.0.0", [page("shared")]),
          record("published", "1.1.0", [page("shared")]),
          record("archived", "1.2.0", [page("shared")]),
        ],
      },
      { list: async () => [report] },
    );

    const dependencies = await index.dependencies("shared");
    expect(assetDependencyCount(dependencies)).toBe(4);
    expect(dependencies).toMatchObject({
      draftTemplates: [{ artifactType: "draft-template", version: "1.0.0" }],
      publishedTemplates: [
        { artifactType: "published-template", version: "1.1.0" },
      ],
      archivedTemplates: [
        { artifactType: "archived-template", version: "1.2.0" },
      ],
      reportInstances: [
        { artifactType: "report-instance", artifactId: report.id },
      ],
    });
  });

  it("fails closed when a persisted artifact cannot be scanned", async () => {
    const index = new AssetReferenceIndex(
      { listAll: async () => Promise.reject(new Error("corrupt template")) },
      { list: async () => [] },
    );
    await expect(index.dependencies("asset-one")).rejects.toThrow(
      "corrupt template",
    );
  });
});
