import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
    expect(resolveMarketMapAsset(id)).toBe(`/report-assets/maps/${fileName}`);
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
});
