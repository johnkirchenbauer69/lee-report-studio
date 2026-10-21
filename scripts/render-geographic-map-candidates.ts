import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CHICAGO_SUBMARKETS } from "../src/report-engine/submarkets.ts";
import { renderVectorMap, type MapFeature } from "../src/report-engine/geographic/vectorMap.ts";
import { ACTIVITY_SECTIONS } from "../src/report-engine/geographic/activity.ts";
import type { ReportInstance } from "../src/report-engine/schema/generation.ts";
import { contributorSection } from "../server/integrations/ascendix/contributors.ts";
import { outlineMapLabels } from "../server/renderers/outlineMapLabels.ts";

const [basemapRoot, reportPath, coordinatesPath, outputPath, fontDirectory] = process.argv.slice(2);
if (!basemapRoot || !reportPath || !coordinatesPath || !outputPath) throw new Error("Usage: tsx scripts/render-geographic-map-candidates.ts <basemap directory> <frozen report> <coordinate evidence> <new output directory>");
const read = async (filename: string) => JSON.parse((await readFile(filename, "utf8")).replace(/^\uFEFF/, ""));
const report = await read(reportPath) as ReportInstance;
const coordinateEvidence = await read(coordinatesPath);
if (!fontDirectory) throw new Error("Supply the approved Document fonts directory as the fifth argument");
const regular = await readFile(path.join(fontDirectory, "b014d2b0113929273927dfa34d613c240b34e1bdacd953274b82c564f338bd7b.ttf"));
const bold = await readFile(path.join(fontDirectory, "4f7fe7bdbc69aa5e94d79d62d04542f05052623c1ebdb738a4d344c9361aa9b9.ttf"));
if (!coordinateEvidence.done || coordinateEvidence.records.length !== coordinateEvidence.totalSize) throw new Error("Coordinate evidence incomplete");
await mkdir(outputPath, { recursive: false });
const qa: unknown[] = [];
for (const market of CHICAGO_SUBMARKETS) {
  const directory = path.join(basemapRoot, market.id);
  const { bounds, boundary } = await read(path.join(directory, "boundary.json"));
  const layers: Record<string, MapFeature[]> = {};
  for (const layer of ["primary", "secondary", "local", "water", "municipalities", "parks"]) layers[layer] = (await read(path.join(directory, `${layer}.geojson`))).features;
  const detail = report.dataSnapshot.submarketDetails.find(item => item.name === market.canonicalName)!;
  const flags: string[] = [];
  const markers: { code: string; longitude: number; latitude: number; color: string }[] = [];
  for (const section of ACTIVITY_SECTIONS) for (const [index, record] of detail[section.key].slice(0, 3).entries()) {
    const code = `${section.code}${index + 1}`;
    let matches = coordinateEvidence.records.filter((row: Record<string, unknown>) => row.Submarket__c === market.canonicalName &&
      contributorSection(row.Contributor_Category__c) === section.key && row.Address__c === record.address);
    if (new Set(matches.map((row: Record<string, unknown>) => row.Property__c)).size > 1) {
      matches = matches.filter((row: Record<string, unknown>) => section.key === "construction" && "sizeSf" in record
        ? row.Under_Construction_SF__c === record.sizeSf : section.key === "sales" && "price" in record ? row.Sale_Price__c === record.price : false);
    }
    const propertyIds = new Set(matches.map((row: Record<string, unknown>) => row.Property__c));
    if (propertyIds.size !== 1) { flags.push(`${code}: no unambiguous exact address-to-property match`); continue; }
    const property = matches[0].Property__r;
    if (property.Submarket_Picklist__c !== market.canonicalName) flags.push(`${code}: property assignment differs from contributor`);
    markers.push({ code, longitude: property.ascendix__Geolocation__Longitude__s, latitude: property.ascendix__Geolocation__Latitude__s, color: section.color });
  }
  const municipalities = layers.municipalities!.map(feature => ({ name: String(feature.properties?.BASENAME ?? ""),
    longitude: Number(feature.properties?.CENTLON), latitude: Number(feature.properties?.CENTLAT), area: Number(feature.properties?.AREALAND) }))
    .filter(city => city.name && Number.isFinite(city.longitude) && Number.isFinite(city.latitude))
    .sort((a, b) => b.area - a.area);
  try {
    const rendered = renderVectorMap({ width: 380, height: 582, bounds, boundary,
      primary: layers.primary!, secondary: layers.secondary!, local: layers.local!, water: layers.water!, parks: layers.parks!, municipalities, markers });
    const portableSvg = outlineMapLabels(rendered.svg, regular, bold);
    await writeFile(path.join(outputPath, `${market.id}.svg`), portableSvg);
    await sharp(Buffer.from(portableSvg), { density: 144 }).png().toFile(path.join(outputPath, `${market.id}.png`));
    qa.push({ market: market.id, markers: markers.length, flags, placements: rendered.placements, vegetation: "Census 2025 area landmarks" });
    console.log(`${market.id}: ${markers.length} markers, ${flags.length} flags`);
  } catch (error) { qa.push({ market: market.id, error: String(error), flags }); console.error(`${market.id}: ${String(error)}`); }
}
await writeFile(path.join(outputPath, "QA.json"), JSON.stringify({ status: "unapproved-candidates", reportId: report.id, revision: report.revision,
  coordinates: "Supplemental parent-property read 2026-10-21; original research values and narratives unchanged", markets: qa }, null, 2));
await writeFile(path.join(outputPath, "Review.html"), `<!doctype html><meta charset="utf-8"><title>All-market map candidates</title><style>body{font:16px Arial;background:#eee;margin:24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}article{background:white;padding:16px}img{width:100%}</style><h1>Geographic maps — unapproved candidates</h1><p>Frozen Q3 report values; supplemental current property coordinates. Full-page QA pending.</p><div class="grid">${CHICAGO_SUBMARKETS.map(market => `<article><h2>${market.displayName}</h2><img src="${market.id}.png"></article>`).join("")}</div>`);
