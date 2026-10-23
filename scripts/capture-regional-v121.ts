import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CHICAGO_SUBMARKETS } from "../src/report-engine/submarkets.ts";
import { frameBounds } from "../src/report-engine/geographic/vectorMap.ts";
import { CENSUS_BASEMAP_LAYERS, captureCensusLayer } from "../server/templates/censusBasemap.ts";
const [root, output] = process.argv.slice(2);
if (!root || !output) throw Error("Supply verified Variant B basemap root and new regional output directory");
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const manifest = JSON.parse(await readFile(path.join(root, "display-manifest.json"), "utf8"));
const outlines: unknown[] = [], parks: unknown[] = [], evidence: unknown[] = [];
const extent = [Infinity, Infinity, -Infinity, -Infinity];
for (const market of CHICAGO_SUBMARKETS) for (const layer of ["boundary", "parks"]) {
  const bytes = await readFile(path.join(root, market.id, `${layer}.${layer === "boundary" ? "json" : "geojson"}`));
  const entry = manifest.find((x: any) => x.market === market.id && x.layer === layer);
  if (!entry || hash(bytes) !== entry.displaySha256) throw Error(`Integrity failure: ${market.id}/${layer}`);
  evidence.push(entry);
  const data = JSON.parse(bytes.toString());
  if (layer === "parks") parks.push(...data.features);
  else {
    outlines.push(...data.boundary.geometry.coordinates);
    extent[0] = Math.min(extent[0]!, data.bounds[0]); extent[1] = Math.min(extent[1]!, data.bounds[1]);
    extent[2] = Math.max(extent[2]!, data.bounds[2]); extent[3] = Math.max(extent[3]!, data.bounds[3]);
  }
}
const bounds = frameBounds([extent[0]! - .12, extent[1]! - .10, extent[2]! + .12, extent[3]! + .10], 380, 582);
await mkdir(output, { recursive: false });
const layers: Record<string, unknown> = { parks, local: [] };
for (const name of ["primary", "secondary", "water", "municipalities"]) {
  const layer = CENSUS_BASEMAP_LAYERS.find(x => x.name === name)!;
  const captured = await captureCensusLayer({ ...layer, ...(name === "water" ? { where: "AREAWATER >= 100000" } : {}) }, bounds);
  layers[name] = captured.collection.features;
  await writeFile(path.join(output, `${name}.source.json`), JSON.stringify(captured));
  evidence.push(captured.manifest);
  console.log(`${name}: ${captured.manifest.featureCount} verified features`);
}
const context = JSON.stringify({ bounds, boundary: { geometry: { type: "MultiPolygon", coordinates: outlines } }, ...layers });
await writeFile(path.join(output, "context.json"), context, { flag: "wx" });
await writeFile(path.join(output, "manifest.json"), JSON.stringify({ version: "1.2.1", sha256: hash(context), evidence }, null, 2), { flag: "wx" });
console.log(`Regional context complete: ${hash(context)}`);
