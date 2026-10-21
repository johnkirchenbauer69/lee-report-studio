import { createHash } from "node:crypto";
import { CHICAGO_SUBMARKETS } from "../../src/report-engine/submarkets.ts";
import type { MapFeature } from "../../src/report-engine/geographic/vectorMap.ts";

export interface BoundaryMapping {
  sourceSha256: string;
  features: { submarketKey: string; canonicalName: string; sourceFeatureIndex: number }[];
}

/** Feature indexes are safe only within the exact hashed source; duplicate legacy IDs are ignored. */
export function readBoundaryCatalog(bytes: Buffer, mapping: BoundaryMapping) {
  if (createHash("sha256").update(bytes).digest("hex") !== mapping.sourceSha256)
    throw new Error("Boundary source changed. The display mapping must be reviewed before use.");
  const source = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as { features: MapFeature[] };
  const catalog = new Map<string, MapFeature>();
  const usedIndexes = new Set<number>();
  for (const market of CHICAGO_SUBMARKETS) {
    const matches = mapping.features.filter(entry => entry.submarketKey === market.id && entry.canonicalName === market.canonicalName);
    if (matches.length !== 1) throw new Error(`Missing or ambiguous boundary mapping: ${market.id}`);
    const index = matches[0]!.sourceFeatureIndex;
    const feature = source.features[index];
    if (!feature || !["Polygon", "MultiPolygon"].includes(feature.geometry.type) || usedIndexes.has(index))
      throw new Error(`Invalid reporting polygon: ${market.id}`);
    usedIndexes.add(index);
    catalog.set(market.id, structuredClone(feature));
  }
  return catalog;
}
