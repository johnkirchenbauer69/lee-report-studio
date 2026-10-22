import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IndustrialMarketReport } from "../../src/report-engine/schema/industrialMarketReport.ts";
import { activitySections, overallActivitySections } from "../../src/report-engine/geographic/activity.ts";
import { renderVectorMap, type MapFeature } from "../../src/report-engine/geographic/vectorMap.ts";
import { resolveChicagoSubmarket } from "../../src/report-engine/submarkets.ts";
import { outlineMapLabels } from "../renderers/outlineMapLabels.ts";
import type { FileSystemAssetStore } from "../assets/assetStore.ts";

const regularHash = "b014d2b0113929273927dfa34d613c240b34e1bdacd953274b82c564f338bd7b";
const boldHash = "4f7fe7bdbc69aa5e94d79d62d04542f05052623c1ebdb738a4d344c9361aa9b9";

export async function prepareGeographicReport(report: IndustrialMarketReport, root: string, store: FileSystemAssetStore) {
  const assets = await store.list();
  const fonts = await Promise.all([regularHash, boldHash].map(async checksum => {
    const asset = assets.find(item => item.type === "font" && item.checksum === checksum);
    if (!asset) throw new Error(`Approved map font unavailable: ${checksum}`);
    const bytes = await readFile(store.resolve(asset));
    if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Map font integrity failure");
    return bytes;
  }));
  const manifest = JSON.parse(await readFile(path.join(root, "display-manifest.json"), "utf8")) as { market: string; layer: string; displaySha256: string }[];
  const result = structuredClone(report);
  for (const detail of result.submarketDetails) {
    const market = resolveChicagoSubmarket(detail.id ?? detail.name);
    if (!market) throw new Error(`Unknown reporting market: ${detail.name}`);
    const directory = path.join(root, market.id);
    const boundaryBytes = await readFile(path.join(directory, "boundary.json"));
    const boundaryEntry = manifest.find(item => item.market === market.id && item.layer === "boundary");
    if (!boundaryEntry || createHash("sha256").update(boundaryBytes).digest("hex") !== boundaryEntry.displaySha256)
      throw new Error(`Boundary integrity failure: ${market.id}`);
    const { bounds, boundary } = JSON.parse(boundaryBytes.toString("utf8"));
    const layers: Record<string, MapFeature[]> = {};
    for (const layer of ["primary", "secondary", "local", "water", "municipalities", "parks"]) {
      const bytes = await readFile(path.join(directory, `${layer}.geojson`));
      const expected = manifest.find(item => item.market === market.id && item.layer === layer);
      if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected.displaySha256)
        throw new Error(`Basemap integrity failure: ${market.id}/${layer}`);
      layers[layer] = JSON.parse(bytes.toString("utf8")).features;
    }
    const markers = activitySections(detail).flatMap(section => section.entries.map(entry => {
      const location = entry.record.location;
      if (!location || location.latitude === null || location.longitude === null)
        throw new Error(`Missing property coordinate: ${market.canonicalName} ${entry.code}`);
      return { code: entry.code, longitude: location.longitude, latitude: location.latitude, color: section.color };
    }));
    const municipalities = layers.municipalities!.map(feature => ({ name: String(feature.properties?.BASENAME ?? ""),
      longitude: Number(feature.properties?.CENTLON), latitude: Number(feature.properties?.CENTLAT), area: Number(feature.properties?.AREALAND) }))
      .filter(city => city.name && Number.isFinite(city.longitude) && Number.isFinite(city.latitude)).sort((a, b) => b.area - a.area);
    const rendered = renderVectorMap({ width: 380, height: 582, bounds, boundary, primary: layers.primary!, secondary: layers.secondary!,
      local: layers.local!, water: layers.water!, parks: layers.parks!, municipalities, markers });
    const portable = outlineMapLabels(rendered.svg, fonts[0]!, fonts[1]!);
    const checksum = createHash("sha256").update(portable).digest("hex");
    let asset = assets.find(item => item.checksum === checksum && item.mimeType === "image/svg+xml");
    if (asset && createHash("sha256").update(await readFile(store.resolve(asset))).digest("hex") !== checksum)
      throw new Error(`Saved map integrity failure: ${market.id}`);
    if (!asset) {
      asset = await store.importBuffer({ buffer: Buffer.from(portable), mimeType: "image/svg+xml", name: `${market.id}-activity.svg` });
      assets.push(asset);
    }
    detail.activityMapAssetUrl = asset.source;
    detail.activityMapChecksum = asset.checksum;
  }
  // A regional extent and pooled market-wide Top 3 belong to the same frozen
  // report. We compose verified local basemap layers rather than moving pins or
  // selecting three records per submarket.
  const outlines: [number, number][][][] = [];
  const extent = [Infinity, Infinity, -Infinity, -Infinity];
  const primary: MapFeature[] = [], secondary: MapFeature[] = [], municipalities: {
    name: string; longitude: number; latitude: number; area: number;
  }[] = [];
  for (const detail of result.submarketDetails) {
    const market = resolveChicagoSubmarket(detail.id ?? detail.name)!;
    const directory = path.join(root, market.id);
    const boundaryBytes = await readFile(path.join(directory, "boundary.json"));
    const expectedBoundary = manifest.find(item => item.market === market.id && item.layer === "boundary");
    if (!expectedBoundary || createHash("sha256").update(boundaryBytes).digest("hex") !== expectedBoundary.displaySha256)
      throw new Error(`Regional boundary integrity failure: ${market.id}`);
    const { bounds, boundary } = JSON.parse(boundaryBytes.toString("utf8")) as {
      bounds: [number, number, number, number]; boundary: MapFeature;
    };
    if (boundary.geometry.type !== "MultiPolygon") throw new Error(`Regional boundary shape unavailable: ${market.id}`);
    outlines.push(...boundary.geometry.coordinates);
    extent[0] = Math.min(extent[0]!, bounds[0]); extent[1] = Math.min(extent[1]!, bounds[1]);
    extent[2] = Math.max(extent[2]!, bounds[2]); extent[3] = Math.max(extent[3]!, bounds[3]);
    for (const layer of ["primary", "secondary", "municipalities"] as const) {
      const bytes = await readFile(path.join(directory, `${layer}.geojson`));
      const expected = manifest.find(item => item.market === market.id && item.layer === layer);
      if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected.displaySha256)
        throw new Error(`Regional basemap integrity failure: ${market.id}/${layer}`);
      const features = JSON.parse(bytes.toString("utf8")).features as MapFeature[];
      if (layer === "primary") primary.push(...features);
      else if (layer === "secondary") secondary.push(...features);
      else municipalities.push(...features.map(feature => ({ name: String(feature.properties?.BASENAME ?? ""),
        longitude: Number(feature.properties?.CENTLON), latitude: Number(feature.properties?.CENTLAT),
        area: Number(feature.properties?.AREALAND) }))
        .filter(city => city.name && Number.isFinite(city.longitude) && Number.isFinite(city.latitude)));
    }
  }
  if (result.submarketDetails.length !== 18) throw new Error("Regional map requires all 18 assigned submarkets");
  const markers = overallActivitySections(result).flatMap(section => section.entries.map(entry => {
    const location = entry.record.location;
    if (!location || location.latitude === null || location.longitude === null)
      throw new Error(`Missing regional property coordinate: ${entry.code}`);
    return { code: entry.code, longitude: location.longitude, latitude: location.latitude, color: section.color };
  }));
  const bounds: [number, number, number, number] = [extent[0]! - .12, extent[1]! - .10, extent[2]! + .12, extent[3]! + .10];
  const regional = renderVectorMap({ width: 380, height: 582, bounds,
    boundary: { geometry: { type: "MultiPolygon", coordinates: outlines } }, primary, secondary,
    local: [], water: [], parks: [],
    municipalities: [...new Map(municipalities.sort((a, b) => b.area - a.area).map(city => [city.name, city])).values()],
    markers });
  const portable = outlineMapLabels(regional.svg, fonts[0]!, fonts[1]!);
  const checksum = createHash("sha256").update(portable).digest("hex");
  let asset = assets.find(item => item.checksum === checksum && item.mimeType === "image/svg+xml");
  if (asset && createHash("sha256").update(await readFile(store.resolve(asset))).digest("hex") !== checksum)
    throw new Error("Regional map asset integrity failure");
  if (!asset) asset = await store.importBuffer({ buffer: Buffer.from(portable), mimeType: "image/svg+xml", name: "overall-market-activity.svg" });
  result.overallActivityMapAssetUrl = asset.source;
  result.overallActivityMapChecksum = asset.checksum;
  return result;
}
