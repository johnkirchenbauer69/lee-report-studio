import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { StoredTemplateVersion } from "../src/types/templateLibrary.ts";
import { classicFamilyTemplate, APPROVED_CLASSIC_SOURCE } from "../server/templates/canonicalFamilies.ts";
import { geographicFamilyTemplate } from "../server/templates/geographicFamily.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import type { ReportInstance } from "../src/report-engine/schema/generation.ts";

const [manifestPath, reportPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !reportPath || !outputPath) throw new Error("Usage: tsx scripts/build-canonical-template-candidates.ts <template manifest> <frozen report> <new output directory>");
const records = JSON.parse(await readFile(manifestPath, "utf8")) as StoredTemplateVersion[];
const source = records.find(item => item.id === APPROVED_CLASSIC_SOURCE.id && item.version === APPROVED_CLASSIC_SOURCE.version);
if (!source) throw new Error("Approved Classic source not found");
const report = JSON.parse((await readFile(reportPath, "utf8")).replace(/^\uFEFF/, "")) as ReportInstance;
if (report.templateChecksum !== APPROVED_CLASSIC_SOURCE.checksum) throw new Error("Frozen reference report uses another layout revision");
const classic = classicFamilyTemplate(source), geographic = geographicFamilyTemplate(classic);
const presentation = buildPresentationModel(report.dataSnapshot);
const candidates = [classic, geographic].map(template => {
  const pages = expandTemplatePages(template, presentation);
  if (pages.length !== 44) throw new Error(`${template.name} expanded to ${pages.length} pages`);
  if (template.id === geographic.id && pages.filter(page => page.elements.filter(element => element.type === "chart").length === 4).length !== 18)
    throw new Error("Geographic does not contain 18 four-chart analytical pages");
  return { template, pages };
});
await mkdir(outputPath, { recursive: false });
for (const candidate of candidates) await writeFile(path.join(outputPath, `${candidate.template.id}.json`), JSON.stringify(candidate, null, 2));
const evidence = { status: "layout-candidates-not-published", sourceChecksum: source.checksum,
  reportId: report.id, reportRevision: report.revision,
  candidates: candidates.map(({ template, pages }) => ({ id: template.id, version: template.version,
    checksum: createHash("sha256").update(JSON.stringify(template)).digest("hex"), pages: pages.length })),
  pending: ["All-market basemap assets and coverage", "Visual fidelity validation", "Font and link preflight", "Adobe execution", "Hosted deployment"] };
await writeFile(path.join(outputPath, "validation.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
