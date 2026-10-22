import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { sanitizeSalesforceClientPayload } from "../src/shared/salesforceIds.ts";
import { capturePresentationAssets } from "../server/market-assets/snapshot.ts";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";

const [snapshotPath, outputPath] = process.argv.slice(2);
if (!snapshotPath || !outputPath) throw new Error("Expected preserved snapshot and new QA report paths");
const repository = new FileSystemTemplateRepository("server/data");
const edition = await repository.get("industrial-market-geographic", "1.2.0");
if (!edition || edition.status !== "draft") throw new Error("Geographic v1.2 draft missing");
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
if (snapshot.report?.report?.period !== "2026 Q3" || snapshot.report?.submarketDetails?.length !== 18)
  throw new Error("Frozen Q3 snapshot identity or market coverage differs");
const data = structuredClone(snapshot.report);
data.report.templateId = edition.id;
data.overallActivityMapAssetUrl = "/api/assets/44f72237-dfd1-46c1-8ec8-10251d28b89b/content";
data.overallActivityMapChecksum = "d0463f142d2c159cc2e255111aecf7b9ec4f5a104dee3836bbc524f73df6a9af";
const renderData = sanitizeSalesforceClientPayload(data);
const shell = JSON.parse(await readFile("server/data/report-instances/report-ceb384c3-6622-4452-b7fd-1f60739ff6cd.json", "utf8"));
const report = { ...shell, id: randomUUID(), status: "draft", templateId: edition.id,
  templateVersion: edition.version, templateChecksum: edition.checksum, dataSnapshot: renderData,
  fontReferences: edition.managedFontReferences,
  pages: expandTemplatePages(edition.template, buildPresentationModel(renderData)) };
if (report.pages.length !== 44) throw new Error(`Expected 44 pages; found ${report.pages.length}`);
const captured = await capturePresentationAssets(report, new FileSystemAssetStore("server/data"));
await writeFile(outputPath, JSON.stringify(captured));
console.log(JSON.stringify({ outputPath, pages: report.pages.length, snapshotId: snapshot.id,
  templateVersion: report.templateVersion, templateChecksum: report.templateChecksum }));
