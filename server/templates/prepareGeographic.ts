import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IndustrialMarketReport } from "../../src/report-engine/schema/industrialMarketReport.ts";
import { activitySections } from "../../src/report-engine/geographic/activity.ts";
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
  return result;
}
