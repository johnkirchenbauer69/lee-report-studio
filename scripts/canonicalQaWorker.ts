import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { classicFamilyTemplate, APPROVED_CLASSIC_SOURCE } from "../server/templates/canonicalFamilies.ts";
import { geographicFamilyTemplate } from "../server/templates/geographicFamily.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { prepareTemplateForPublication, prepareTemplateForReport } from "../src/report-engine/generation/prepareTemplate.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
import { ChromiumPdfRenderer } from "../server/renderers/chromiumPdfRenderer.ts";
import type { ReportInstance } from "../src/report-engine/schema/generation.ts";
import type { StoredTemplateVersion } from "../src/types/templateLibrary.ts";
import { resolveChicagoSubmarket } from "../src/report-engine/submarkets.ts";

const [reportPath, mapRoot, outputRoot, dataRoot = "server/data", liveFixturePath, selectedMarkets] = process.argv.slice(2);
if (!reportPath || !mapRoot || !outputRoot) throw new Error("Expected frozen report, map directory, new output directory, optional data root and app URL");
const controller = new AbortController();
process.on("message", message => { if (message === "abort") controller.abort("Global QA deadline"); });
const started = Date.now();
const log = (stage: string, detail?: unknown) => console.log(JSON.stringify({ at: new Date().toISOString(), elapsedMs: Date.now() - started, stage, detail }));
const servers: Server[] = [];
try {
log("source-loading");
const report = JSON.parse((await readFile(reportPath, "utf8")).replace(/^\uFEFF/, "")) as ReportInstance;
const records = JSON.parse(await readFile(path.join(dataRoot, "templates/templates.json"), "utf8")) as StoredTemplateVersion[];
const source = records.find(item => item.id === APPROVED_CLASSIC_SOURCE.id && item.version === APPROVED_CLASSIC_SOURCE.version)!;
const classic = classicFamilyTemplate(source);
const data = structuredClone(report.dataSnapshot);
let fixture: { snapshot: { id: string; hash: string }; report: typeof data } | undefined;
if (liveFixturePath) {
  fixture = JSON.parse(await readFile(liveFixturePath, "utf8"));
  Object.assign(data, fixture!.report);
}
const mapFiles = new Map<string, Buffer>();
const assetServer = createServer((request, response) => {
  const bytes = mapFiles.get(request.url ?? "");
  if (!bytes) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": "image/svg+xml", "access-control-allow-origin": "*" });
  response.end(bytes);
});
servers.push(assetServer);
await new Promise<void>((resolve, reject) => { assetServer.once("error", reject); assetServer.listen(0, "127.0.0.1", resolve); });
const address = assetServer.address();
if (!address || typeof address === "string") throw new Error("QA asset server unavailable");
const qaApp = express();
const store = new FileSystemAssetStore(dataRoot);
const assets = await store.list();
let currentJob: unknown;
qaApp.get("/api/assets", (_request, response) => response.json({ assets }));
qaApp.get("/api/assets/:id/content", (request, response) => {
  const asset = assets.find(item => item.id === request.params.id);
  if (!asset) { response.sendStatus(404); return; }
  response.sendFile(path.resolve(store.resolve(asset)));
});
qaApp.get("/api/render-jobs/:id", (_request, response) => response.json(currentJob));
qaApp.use(express.static(path.resolve("dist")));
const qaServer = qaApp.listen(0, "127.0.0.1");
servers.push(qaServer);
await new Promise<void>((resolve, reject) => { qaServer.once("error", reject); qaServer.once("listening", resolve); });
const qaAddress = qaServer.address();
if (!qaAddress || typeof qaAddress === "string") throw new Error("QA renderer unavailable");
const renderer = new ChromiumPdfRenderer();
for (const detail of data.submarketDetails) {
  const market = resolveChicagoSubmarket(detail.id ?? detail.name)!;
  if (fixture) continue; // The live fixture already pins its own matching map assets.
  const bytes = await readFile(path.join(mapRoot, `${market.id}.svg`));
  mapFiles.set(`/${market.id}.svg`, bytes);
  detail.activityMapAssetUrl = `http://127.0.0.1:${address.port}/${market.id}.svg`;
  detail.activityMapChecksum = createHash("sha256").update(bytes).digest("hex");
}
await mkdir(outputRoot, { recursive: false });
const presentation = buildPresentationModel(data);
const evidence = [];
const selection = selectedMarkets?.split(",").map(value => resolveChicagoSubmarket(value)?.id ?? (() => { throw new Error(`Unknown submarket ${value}`); })());
for (const family of (selection ? [geographicFamilyTemplate(classic)] : [classic, geographicFamilyTemplate(classic)])) {
  controller.signal.throwIfAborted();
  log("family-start", { family: family.id, selection: selection ?? "all" });
  const prepared = prepareTemplateForReport(family, data, presentation, "ascendix", "published");
  const template = prepareTemplateForPublication({ ...prepared, pages: expandTemplatePages(prepared, presentation) }, fixture ? [] : report.manualOverrides);
  if (template.pages.length !== 44) throw new Error("Expected 44 source pages");
  if (selection) template.pages = template.pages.filter(page => page.geographyId && selection.includes(page.geographyId));
  if (template.pages.length !== (selection ? selection.length * 2 : 44)) throw new Error("Unexpected selected page count");
  template.pages.forEach((page, index) => log("page-planned", { page: index + 1, name: page.name, submarket: page.geographyId, maps: page.elements.filter(element => element.type === "image" && element.name?.toLowerCase().includes("map")).map(element => ({ id: element.id, name: element.name })) }));
  await writeFile(path.join(outputRoot, `${family.id}.json`), JSON.stringify({ template, data: presentation }));
  currentJob = { template, data: presentation, title: `${family.name} — layout QA` };
  let narrativeOverflow: string[] = [];
  const bytes = Buffer.from(await renderer.render({ url: `http://127.0.0.1:${qaAddress.port}/?printJob=qa`, title: `${family.name} — layout QA`,
    signal: controller.signal, onProgress: (stage, detail) => log(stage, { family: family.id, detail }),
    onLayout: layout => { narrativeOverflow = layout.narrativeOverflow; } }));
  const pdf = await PDFDocument.load(bytes);
  if (pdf.getPageCount() !== template.pages.length) throw new Error("Exported PDF page count mismatch");
  await writeFile(path.join(outputRoot, `${family.id}.pdf`), bytes);
  evidence.push({ family: family.id, pages: pdf.getPageCount(), narrativeOverflow });
  console.log(JSON.stringify(evidence.at(-1)));
}
await writeFile(path.join(outputRoot, "QA.json"), JSON.stringify({ status: "layout-review-only", sourceReport: fixture?.snapshot.id ?? report.id, revision: fixture ? undefined : report.revision,
  sourceHash: fixture?.snapshot.hash,
  limitations: fixture ? ["Separate live-generation test snapshot; no generated narratives or published-report edits"] :
    ["Historical snapshot predates featured selection; deliberately empty featured cards", "Supplemental map assets; no published report changed"], evidence }, null, 2));
log("success");
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  log("server-cleanup");
  await Promise.all(servers.map(server => new Promise<void>(resolve => {
    server.close(() => resolve()); server.closeAllConnections();
  })));
  process.disconnect?.();
}
