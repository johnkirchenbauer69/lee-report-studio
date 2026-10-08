import "dotenv/config";
import path from "node:path";
import { sampleTemplate } from "../src/data/sampleTemplate.ts";
import { withNativeClosingPages } from "../src/report-engine/closing/migrateClosingPages.ts";
import { normalizeReportTemplateFonts } from "../src/services/templateNormalization.ts";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";

const root = path.resolve(process.env.LEE_DATA_DIR ?? "server/data");
const sourceVersion = process.env.LEE_NATIVE_CLOSING_SOURCE_VERSION;
if (!sourceVersion) throw new Error("Set LEE_NATIVE_CLOSING_SOURCE_VERSION to the reviewed source version. This command creates a new draft only.");
const repository = new FileSystemTemplateRepository(root);
const assets = new FileSystemAssetStore(root);
await assets.initialize();
const source = await repository.get(sampleTemplate.id, sourceVersion);
if (!source) throw new Error(`Source v${sourceVersion} was not found.`);
const template = normalizeReportTemplateFonts(withNativeClosingPages(source.template, sampleTemplate), await assets.list());
const draft = await repository.createVersion(source.id, source.version, template);
console.log(JSON.stringify({ source: source.version, draft: draft.version, status: draft.status, checksum: draft.checksum }, null, 2));
