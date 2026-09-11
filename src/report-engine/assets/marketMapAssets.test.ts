import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import {
  MARKET_MAP_ASSET_REGISTRY,
  resolveMarketMapAsset,
} from "./marketMapAssets";
import { CHICAGO_SUBMARKETS } from "../submarkets";

describe("managed market map assets", () => {
  it("resolves the Overall Market map", () => {
    expect(resolveMarketMapAsset("overall-market")).toBe(
      "/report-assets/maps/Overall_Market_Map.jpg",
    );
  });

  it.each([
    ["central-dupage", "Central_DuPage_Map.jpg"],
    ["ohare", "O'Hare_Map.jpg"],
    ["west-cook", "West_Cook_Map.jpg"],
    ["i80-joliet", "I-80_Corridor_Map.jpg"],
    ["southeast-wisconsin", "Southeast_Wisconsin_Map.jpg"],
  ])("resolves %s through its canonical ID", (id, fileName) => {
    expect(resolveMarketMapAsset(id)).toBe(
      `/report-assets/maps/normalized/${fileName}`,
    );
  });

  it("fails clearly instead of substituting a map", () => {
    expect(() => resolveMarketMapAsset("i80-joliet", {})).toThrow(
      /Required managed map asset is unavailable.*i80-joliet/,
    );
  });

  it("contains Overall plus all 18 submarket maps", () => {
    expect(Object.keys(MARKET_MAP_ASSET_REGISTRY)).toHaveLength(19);
    expect(
      CHICAGO_SUBMARKETS.every(({ id }) => id in MARKET_MAP_ASSET_REGISTRY),
    ).toBe(true);
    for (const asset of Object.values(MARKET_MAP_ASSET_REGISTRY))
      expect(existsSync(resolve("public", asset.replace(/^\//, "")))).toBe(
        true,
      );
  });

  it.each([
    "Central_DuPage_Map.jpg",
    "Chicago_South_Map.jpg",
    "Fox_Valley_Map.jpg",
    "I-55_Corridor_Map.jpg",
    "O'Hare_Map.jpg",
    "West_Cook_Map.jpg",
  ])("removes continuous vertical source frames from %s", async (fileName) => {
    const derivative = resolve(
      "public/report-assets/maps/normalized",
      fileName,
    );
    const { data, info } = await sharp(derivative)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const darkRatio = (x: number) => {
      let dark = 0;
      for (let y = 0; y < info.height; y += 1) {
        const index = (y * info.width + x) * info.channels;
        const luminance =
          0.2126 * data[index] +
          0.7152 * data[index + 1] +
          0.0722 * data[index + 2];
        if (luminance < 110) dark += 1;
      }
      return dark / info.height;
    };
    const edgeColumns = [
      0,
      1,
      2,
      3,
      info.width - 4,
      info.width - 3,
      info.width - 2,
      info.width - 1,
    ];
    expect(Math.max(...edgeColumns.map(darkRatio))).toBeLessThan(0.9);
  });

  it("retains immutable originals and records derivative provenance", () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve("public/report-assets/maps/normalized/manifest.json"),
        "utf8",
      ),
    ) as {
      derivatives: Array<{
        file: string;
        source: { checksum: string };
        derivative: { checksum: string };
      }>;
    };
    expect(manifest.derivatives).toHaveLength(18);
    for (const entry of manifest.derivatives) {
      const original = readFileSync(
        resolve("public/report-assets/maps", entry.file),
      );
      const derivative = readFileSync(
        resolve("public/report-assets/maps/normalized", entry.file),
      );
      expect(createHash("sha256").update(original).digest("hex")).toBe(
        entry.source.checksum,
      );
      expect(createHash("sha256").update(derivative).digest("hex")).toBe(
        entry.derivative.checksum,
      );
      expect(entry.derivative.checksum).not.toBe(entry.source.checksum);
    }
  });
});
