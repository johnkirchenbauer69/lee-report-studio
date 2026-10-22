import { expect, it, vi } from "vitest";
import { captureCensusLayer, CENSUS_BASEMAP_LAYERS } from "./censusBasemap.ts";
const feature = (id: number) => ({ id, type: "Feature", properties: { OBJECTID: id }, geometry: { type: "LineString", coordinates: [[-88, 42], [-87, 42]] } });
it("requires count reconciliation across all pages", async () => {
  const responses = [{ count: 3 }, { features: [feature(1), feature(2)] }, { features: [feature(3)] }, { count: 3 }];
  const request = vi.fn(async () => new Response(JSON.stringify(responses.shift())));
  const result = await captureCensusLayer(CENSUS_BASEMAP_LAYERS[0], [-89, 41, -87, 43], request);
  expect(result.collection.features).toHaveLength(3);
  expect(result.manifest.coverage).toBe("complete");
});
it("rejects truncated or duplicate pages", async () => {
  const responses = [{ count: 3 }, { features: [feature(1), feature(1)] }];
  await expect(captureCensusLayer(CENSUS_BASEMAP_LAYERS[0], [-89, 41, -87, 43],
    vi.fn(async () => new Response(JSON.stringify(responses.shift()))))).rejects.toThrow("duplicated");
});
