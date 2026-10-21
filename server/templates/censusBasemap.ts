import { createHash } from "node:crypto";
import type { MapFeature } from "../../src/report-engine/geographic/vectorMap.ts";

export const CENSUS_BASEMAP_LAYERS = [
  { name: "primary", service: "Transportation", layer: 2 },
  { name: "secondary", service: "Transportation", layer: 5 },
  { name: "local", service: "Transportation", layer: 7 },
  { name: "water", service: "Hydro", layer: 1 },
  { name: "municipalities", service: "Places_CouSub_ConCity_SubMCD", layer: 4 },
] as const;
type Layer = typeof CENSUS_BASEMAP_LAYERS[number];

/** Freeze complete contextual geometry at preparation time, never during PDF/INDD export. */
export async function captureCensusLayer(layer: Layer, bounds: [number, number, number, number], request = fetch) {
  const endpoint = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/${layer.service}/MapServer/${layer.layer}/query`;
  const base = { where: "1=1", geometry: bounds.join(","), geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects" };
  async function query(params: Record<string, string>) {
    const response = await request(`${endpoint}?${new URLSearchParams({ ...base, ...params })}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Census ${layer.name}: HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(`Census ${layer.name}: ${data.error.message}`);
    return data;
  }
  const { count } = await query({ f: "json", returnCountOnly: "true" });
  if (!Number.isInteger(count) || count < 0) throw new Error("Census returned an invalid feature count");
  const features: MapFeature[] = [];
  const identities = new Set<string>();
  while (features.length < count) {
    const page = await query({ f: "geojson", outFields: "*", returnGeometry: "true", resultRecordCount: "2000",
      resultOffset: String(features.length), orderByFields: "OBJECTID ASC" });
    if (!Array.isArray(page.features) || !page.features.length) throw new Error(`Incomplete Census ${layer.name} coverage`);
    for (const feature of page.features) {
      const id = feature.id ?? feature.properties?.OBJECTID;
      if (id === undefined || identities.has(String(id))) throw new Error(`Missing or duplicated Census ${layer.name} feature identity`);
      identities.add(String(id)); features.push(feature);
    }
    if (features.length > count) throw new Error(`Census ${layer.name} population changed during capture`);
  }
  const finalCount = await query({ f: "json", returnCountOnly: "true" });
  if (finalCount.count !== count) throw new Error(`Census ${layer.name} population changed during capture`);
  const collection = { type: "FeatureCollection", features };
  return { collection, manifest: { layer: layer.name, endpoint, bounds, featureCount: count,
    sha256: createHash("sha256").update(JSON.stringify(collection)).digest("hex"),
    capturedAt: new Date().toISOString(), coverage: "complete" as const,
    attribution: "U.S. Census Bureau TIGERweb; contextual cartography, not research membership." } };
}
