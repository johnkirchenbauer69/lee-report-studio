import { describe, expect, it } from "vitest";
import type { Asset, ReportTemplate } from "../types/report";
import {
  approvedManagedFontAssets,
  collectManagedFontReferences,
  findNonApprovedFontUsages,
  inferFontGovernanceStatus,
} from "./fontGovernance";
import {
  groupFontAssets,
  resolveAvailableManagedFontFace,
} from "./fontRegistry";

const font = (
  id: string,
  family: string,
  overrides: Partial<Asset> = {},
): Asset => ({
  id,
  name: family,
  type: "font",
  mimeType: "font/ttf",
  source: `/api/assets/${id}/content`,
  createdAt: "2026-08-28T00:00:00.000Z",
  fontFamily: family,
  fontWeight: 400,
  fontStyle: "normal",
  checksum: `${id}-checksum`,
  ...overrides,
});

const templateWith = (asset: Asset): ReportTemplate => ({
  id: "governance",
  name: "Governance",
  version: "1.0.0",
  assets: [asset],
  pages: [
    {
      id: "page-1",
      name: "Page 1",
      width: 800,
      height: 600,
      background: "#fff",
      elements: [
        {
          id: "title",
          type: "text",
          name: "Title",
          text: "Title",
          x: 0,
          y: 0,
          width: 100,
          height: 30,
          style: {
            fontFamily: asset.fontFamily,
            fontWeight: 400,
            fontStyle: "normal",
            fontAssetId: asset.id,
            fontChecksum: asset.checksum,
          },
        },
      ],
    },
  ],
});

describe("managed font governance", () => {
  it("recognizes only explicitly accepted production licenses", () => {
    expect(
      inferFontGovernanceStatus(
        font("nunito", "Nunito Sans", {
          license: { type: "SIL Open Font License 1.1" },
        }),
      ),
    ).toBe("approved");
    expect(
      inferFontGovernanceStatus(
        font("cooper", "Cooper Hewitt", {
          license: { fileName: "readme.txt" },
        }),
      ),
    ).toBe("unverified");
    expect(
      inferFontGovernanceStatus(
        font("flamante", "Flamante Round", {
          license: { fileName: "FREE_FOR_PERSONAL_USE_ONLY.pdf" },
        }),
      ),
    ).toBe("restricted");
  });

  it("excludes unverified, restricted, and retired faces from picker groups and selection", () => {
    const approved = font("nunito", "Nunito Sans", {
      fontGovernanceStatus: "approved",
    });
    const assets = [
      approved,
      font("cooper", "Cooper Hewitt", {
        fontGovernanceStatus: "unverified",
      }),
      font("flamante", "Flamante Round", {
        fontGovernanceStatus: "restricted",
      }),
      font("walrus", "Walrus", { fontGovernanceStatus: "retired" }),
    ];
    expect([...groupFontAssets(assets).keys()]).toEqual(["Nunito Sans"]);
    expect(approvedManagedFontAssets(assets)).toEqual([approved]);
    expect(
      resolveAvailableManagedFontFace(assets, "Walrus", 400, "normal"),
    ).toBeUndefined();
  });

  it("reports exact disallowed element pins and only records actually used faces", () => {
    const retired = font("walrus", "Walrus", {
      fontGovernanceStatus: "retired",
    });
    const template = templateWith(retired);
    expect(findNonApprovedFontUsages(template)).toEqual([
      expect.objectContaining({
        pageId: "page-1",
        elementId: "title",
        family: "Walrus",
        status: "retired",
      }),
    ]);
    expect(collectManagedFontReferences(template)).toEqual([
      {
        assetId: "walrus",
        family: "Walrus",
        weight: 400,
        style: "normal",
        checksum: "walrus-checksum",
      },
    ]);
  });
});
