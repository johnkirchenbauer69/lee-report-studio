import { describe, expect, it } from "vitest";
import type { StoredTemplateVersion } from "../../src/types/templateLibrary";
import {
  isTestOwnedAsset,
  isTestOwnedReportInstance,
  isTestOwnedTemplateRecord,
  resolvePublishedRestorations,
} from "./testFixturePollution";

const record = (
  overrides: Partial<StoredTemplateVersion>,
): StoredTemplateVersion =>
  ({
    id: "industrial-market-report",
    name: "Industrial Market Report",
    templateType: "industrial-market-report",
    version: "1.0.0",
    status: "draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    checksum: "checksum",
    pageDefinitionCount: 1,
    template: {} as StoredTemplateVersion["template"],
    assetReferences: [],
    managedFontReferences: [],
    ...overrides,
  }) as StoredTemplateVersion;

describe("isTestOwnedTemplateRecord", () => {
  it("flags the Phase 1B fixture naming convention", () => {
    expect(
      isTestOwnedTemplateRecord({ name: "Phase 1B asset-7ec45606" }),
    ).toBe(true);
    expect(isTestOwnedTemplateRecord({ name: "Industrial Market Report" })).toBe(
      false,
    );
  });
});

describe("isTestOwnedAsset", () => {
  it("flags the phase1b- asset naming convention case-insensitively", () => {
    expect(isTestOwnedAsset({ name: "phase1b-shared-logo" })).toBe(true);
    expect(isTestOwnedAsset({ name: "PHASE1B-unused" })).toBe(true);
    expect(isTestOwnedAsset({ name: "lee-logo-white" })).toBe(false);
  });
});

describe("isTestOwnedReportInstance", () => {
  it("flags a report snapshot named after the fixture convention", () => {
    expect(
      isTestOwnedReportInstance({
        sourceTemplateSnapshot: { name: "Phase 1B asset-7ec45606" },
        pages: [],
      }),
    ).toBe(true);
  });

  it("flags the legacy fixture by its injected marker element even without a snapshot", () => {
    expect(
      isTestOwnedReportInstance({
        sourceTemplateSnapshot: undefined,
        pages: [
          {
            id: "page-1",
            name: "Page 1",
            width: 816,
            height: 1056,
            background: "#fff",
            elements: [
              {
                id: "legacy-0ce51652-marker",
                type: "text",
                name: "Legacy restore marker",
                x: 0,
                y: 0,
                width: 100,
                height: 20,
                text: "Legacy report survived its source",
                style: { opacity: 1 },
              },
            ],
          },
        ],
      } as never),
    ).toBe(true);
  });

  it("does not flag a real report with no matching signal", () => {
    expect(
      isTestOwnedReportInstance({
        sourceTemplateSnapshot: { name: "Industrial Market Report" },
        pages: [],
      }),
    ).toBe(false);
  });
});

describe("resolvePublishedRestorations", () => {
  it("walks back through a chain of removed fixture publishes to the nearest surviving version", () => {
    const real = record({
      version: "1.12.0",
      status: "archived",
      publishedAt: "2026-09-10T22:04:28.313Z",
      updatedAt: "2026-09-10T22:05:02.032Z",
    });
    const fixtureReadonly = record({
      version: "1.15.0",
      name: "Phase 1B readonly-e06d6242",
      status: "archived",
      publishedAt: "2026-09-10T22:05:02.032Z",
      updatedAt: "2026-09-10T22:05:14.998Z",
    });
    const fixtureAsset = record({
      version: "1.17.0",
      name: "Phase 1B asset-7ec45606",
      status: "published",
      publishedAt: "2026-09-10T22:05:14.998Z",
      updatedAt: "2026-09-10T22:05:14.998Z",
    });
    const records = [real, fixtureReadonly, fixtureAsset];
    const isRemoved = (r: StoredTemplateVersion) =>
      isTestOwnedTemplateRecord(r);

    expect(resolvePublishedRestorations(records, isRemoved)).toEqual([
      { id: real.id, version: "1.12.0" },
    ]);
  });

  it("does nothing when the currently published version is real", () => {
    const real = record({ version: "1.3.0", status: "published" });
    expect(
      resolvePublishedRestorations([real], () => false),
    ).toEqual([]);
  });
});
