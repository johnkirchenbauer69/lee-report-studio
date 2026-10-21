import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { classicFamilyTemplate, APPROVED_CLASSIC_SOURCE } from "../server/templates/canonicalFamilies.ts";
import { geographicFamilyTemplate } from "../server/templates/geographicFamily.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { prepareTemplateForPublication, prepareTemplateForReport } from "../src/report-engine/generation/prepareTemplate.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { ReportInstance } from "../src/report-engine/schema/generation.ts";
import type { StoredTemplateVersion } from "../src/types/templateLibrary.ts";
import { resolveChicagoSubmarket } from "../src/report-engine/submarkets.ts";

const [reportPath, mapRoot, outputRoot, dataRoot = "server/data", url = "http://localhost:3000"] = process.argv.slice(2);
if (!reportPath || !mapRoot || !outputRoot) throw new Error("Expected frozen report, map directory, new output directory, optional data root and app URL");
const report = JSON.parse((await readFile(reportPath, "utf8")).replace(/^\uFEFF/, "")) as ReportInstance;
const records = JSON.parse(await readFile(path.join(dataRoot, "templates/templates.json"), "utf8")) as StoredTemplateVersion[];
const source = records.find(item => item.id === APPROVED_CLASSIC_SOURCE.id && item.version === APPROVED_CLASSIC_SOURCE.version)!;
const classic = classicFamilyTemplate(source);
const data = structuredClone(report.dataSnapshot);
const mapFiles = new Map<string, Buffer>();
const assetServer = createServer((request, response) => {
  const bytes = mapFiles.get(request.url ?? "");
  if (!bytes) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": "image/svg+xml", "access-control-allow-origin": "*" });
  response.end(bytes);
});
await new Promise<void>(resolve => assetServer.listen(0, "127.0.0.1", resolve));
const address = assetServer.address();
if (!address || typeof address === "string") throw new Error("QA asset server unavailable");
try {
for (const detail of data.submarketDetails) {
  const market = resolveChicagoSubmarket(detail.id ?? detail.name)!;
  const bytes = await readFile(path.join(mapRoot, `${market.id}.svg`));
  mapFiles.set(`/${market.id}.svg`, bytes);
  detail.activityMapAssetUrl = `http://127.0.0.1:${address.port}/${market.id}.svg`;
  detail.activityMapChecksum = createHash("sha256").update(bytes).digest("hex");
}
await mkdir(outputRoot, { recursive: false });
const presentation = buildPresentationModel(data);
const evidence = [];
for (const family of [classic, geographicFamilyTemplate(classic)]) {
  const prepared = prepareTemplateForReport(family, data, presentation, "ascendix", "published");
  const template = prepareTemplateForPublication({ ...prepared, pages: expandTemplatePages(prepared, presentation) }, report.manualOverrides);
  if (template.pages.length !== 44) throw new Error("Expected 44 pages");
  await writeFile(path.join(outputRoot, `${family.id}.json`), JSON.stringify({ template, data: presentation }));
  const response = await fetch(`${url}/api/render/pdf`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ template, data: presentation, renderMode: "draft", title: `${family.name} — layout QA` }) });
  if (!response.ok) throw new Error(`PDF render failed: ${response.status} ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  await writeFile(path.join(outputRoot, `${family.id}.pdf`), bytes);
  evidence.push({ family: family.id, pages: pdf.getPageCount(), narrativeOverflow: response.headers.get("x-lee-narrative-overflow") });
  console.log(JSON.stringify(evidence.at(-1)));
}
await writeFile(path.join(outputRoot, "QA.json"), JSON.stringify({ status: "layout-review-only", sourceReport: report.id, revision: report.revision,
  limitations: ["Historical snapshot predates featured selection; deliberately empty featured cards", "Supplemental map assets; no published report changed"], evidence }, null, 2));
} finally { assetServer.close(); }
