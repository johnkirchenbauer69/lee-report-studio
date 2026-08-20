import { describe, expect, it } from "vitest";
import { classifyFontFace, type StoredAsset } from "./assetStore";

const stored = (checksum: string): StoredAsset => ({
  id: checksum,
  name: "Nunito Sans Bold",
  type: "font",
  mimeType: "font/ttf",
  source: `/api/assets/${checksum}/content`,
  createdAt: "2026-08-20T00:00:00.000Z",
  fontFamily: "Nunito Sans",
  fontWeight: 700,
  fontStyle: "normal",
  checksum,
  storage: "backend",
  storageKey: `fonts/organization/${checksum}.ttf`,
});

describe("font asset identity", () => {
  const metadata = {
    family: "Nunito Sans",
    weight: 700,
    style: "normal" as const,
    postScriptName: "NunitoSans-Bold",
  };

  it("skips an exact checksum duplicate", () => {
    expect(classifyFontFace([stored("same")], metadata, "same")).toEqual({
      duplicate: true,
      version: 2,
      outcome: "duplicates",
    });
  });

  it("retains a different binary in the same semantic slot as a new version", () => {
    expect(classifyFontFace([stored("old")], metadata, "new")).toEqual({
      duplicate: false,
      version: 2,
      outcome: "conflicts",
    });
  });

  it("imports a previously unseen face as version one", () => {
    expect(classifyFontFace([], metadata, "new")).toEqual({
      duplicate: false,
      version: 1,
      outcome: "imported",
    });
  });
});
