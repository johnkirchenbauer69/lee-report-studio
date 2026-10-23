import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IndustrialMarketReport } from "../../src/report-engine/schema/industrialMarketReport.ts";
import { overallActivitySections } from "../../src/report-engine/geographic/activity.ts";
import { containsMapPoint, renderVectorMap, type MapFeature } from "../../src/report-engine/geographic/vectorMap.ts";
import { outlineMapLabels } from "../renderers/outlineMapLabels.ts";
import type { FileSystemAssetStore } from "../assets/assetStore.ts";

export async function prepareRegionalV121(report: IndustrialMarketReport, root: string, store: FileSystemAssetStore, fonts: Buffer[]) {
  if (report.submarketDetails.length !== 18) throw Error("Regional map requires all 18 reporting submarkets");
  const bytes = await readFile(path.join(root, "context.json"));
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (manifest.version !== "1.2.1" || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256)
    throw Error("Geographic v1.2.1 regional context integrity failure");
  const context = JSON.parse(bytes.toString());
  if (!(context.water as MapFeature[]).some(feature => feature.properties?.BASENAME === "Michigan" &&
    containsMapPoint(feature, [-87.15, 42.5]))) throw Error("Lake Michigan label lacks verified lake geometry");
  const markers = overallActivitySections(report).flatMap(section => section.entries.map(entry => {
    const location = entry.record.location;
    if (!location || location.latitude === null || location.longitude === null) throw Error(`Missing property coordinate: ${entry.code}`);
    return { code: entry.code, longitude: location.longitude, latitude: location.latitude, color: section.color };
  }));
  const municipalities = (context.municipalities as MapFeature[]).map(feature => ({
    name: String(feature.properties?.BASENAME ?? ""), longitude: Number(feature.properties?.CENTLON),
    latitude: Number(feature.properties?.CENTLAT), area: Number(feature.properties?.AREALAND),
  })).filter(city => city.name && Number.isFinite(city.longitude) && Number.isFinite(city.latitude)).sort((a,b) => b.area-a.area);
  const rendered = renderVectorMap({ ...context, width: 380, height: 582, regional: true,
    municipalities, markers, waterLabels: [{ name: "Lake Michigan", longitude: -87.15, latitude: 42.5 }] });
  const portable = outlineMapLabels(rendered.svg, fonts[0]!, fonts[1]!);
  const checksum = createHash("sha256").update(portable).digest("hex");
  let asset = (await store.list()).find(item => item.checksum === checksum && item.mimeType === "image/svg+xml");
  if (asset && createHash("sha256").update(await readFile(store.resolve(asset))).digest("hex") !== checksum)
    throw Error("Regional map asset integrity failure");
  asset ??= await store.importBuffer({ buffer: Buffer.from(portable), mimeType: "image/svg+xml", name: "overall-market-variant-b-v121.svg" });
  return { ...report, overallActivityMapAssetUrl: asset.source, overallActivityMapChecksum: asset.checksum };
}
