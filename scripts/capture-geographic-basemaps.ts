import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readBoundaryCatalog, type BoundaryMapping } from "../server/templates/boundaryCatalog.ts";
import { captureCensusLayer, CENSUS_BASEMAP_LAYERS } from "../server/templates/censusBasemap.ts";
import { frameBounds } from "../src/report-engine/geographic/vectorMap.ts";

const [mappingPath, sourcePath, outputPath] = process.argv.slice(2);
if (!mappingPath || !sourcePath || !outputPath) throw new Error("Usage: tsx scripts/capture-geographic-basemaps.ts <mapping.json> <source.geojson> <new output directory>");
const mapping = JSON.parse(await readFile(mappingPath, "utf8")) as BoundaryMapping;
const catalog = readBoundaryCatalog(await readFile(sourcePath), mapping);
await mkdir(outputPath, { recursive: false });
await writeFile(path.join(outputPath, "boundary-mapping.json"), JSON.stringify({ sourceSha256: mapping.sourceSha256, features: mapping.features }, null, 2));
const jobs: (() => Promise<void>)[] = [];
for (const [id, boundary] of catalog) {
  const coordinates: number[][] = [];
  function collect(value: unknown) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") { coordinates.push(value as number[]); return; }
    value.forEach(collect);
  }
  collect(boundary.geometry.coordinates);
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lon, lat] of coordinates) {
    west = Math.min(west, lon!); east = Math.max(east, lon!); south = Math.min(south, lat!); north = Math.max(north, lat!);
  }
  const dx = (east - west) * .15, dy = (north - south) * .15;
  const bounds = frameBounds([west - dx, south - dy, east + dx, north + dy], 380, 582);
  const directory = path.join(outputPath, id);
  await mkdir(directory);
  await writeFile(path.join(directory, "boundary.json"), JSON.stringify({ bounds, boundary, sourceSha256: mapping.sourceSha256 }));
  for (const layer of CENSUS_BASEMAP_LAYERS) jobs.push(async () => {
    const captured = await captureCensusLayer(layer, bounds);
    await writeFile(path.join(directory, `${layer.name}.geojson`), JSON.stringify(captured.collection));
    await writeFile(path.join(directory, `${layer.name}.manifest.json`), JSON.stringify(captured.manifest, null, 2));
    console.log(`${id}/${layer.name}: ${captured.manifest.featureCount} complete`);
  });
}
const failures: string[] = [];
async function worker() {
  while (jobs.length) {
    const job = jobs.shift()!;
    try { await job(); } catch (error) { failures.push(String(error)); console.error(String(error)); }
  }
}
await Promise.all([worker(), worker(), worker()]);
await writeFile(path.join(outputPath, "capture-status.json"), JSON.stringify({ status: failures.length ? "incomplete" : "complete", failures }, null, 2));
if (failures.length) process.exitCode = 1;
