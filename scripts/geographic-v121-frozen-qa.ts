import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
import { prepareRegionalV121 } from "../server/templates/prepareRegionalV121.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { capturePresentationAssets } from "../server/market-assets/snapshot.ts";
const [source, output] = process.argv.slice(2);
if (!source || !output || source === output) throw Error("Supply preserved source report and separate new output");
const raw = await readFile(source);
const previous = JSON.parse(raw.toString());
const store = new FileSystemAssetStore("server/data");
const assets = await store.list();
const fonts = await Promise.all(["b014d2b0113929273927dfa34d613c240b34e1bdacd953274b82c564f338bd7b", "4f7fe7bdbc69aa5e94d79d62d04542f05052623c1ebdb738a4d344c9361aa9b9"].map(async hash => {
  const asset = assets.find(a => a.checksum === hash && a.type === "font");
  if (!asset) throw Error("Approved map font missing");
  const bytes = await readFile(store.resolve(asset));
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw Error("Font integrity failure");
  return bytes;
}));
const edition = await new FileSystemTemplateRepository("server/data").get("industrial-market-geographic", "1.2.1");
if (!edition) throw Error("Prepare Geographic v1.2.1 first");
const data = await prepareRegionalV121(previous.dataSnapshot, "server/data/geographic-basemaps/regional-v121", store, fonts);
const report = { ...previous, id: randomUUID(), status: "draft", templateVersion: edition.version,
  templateChecksum: edition.checksum, dataSnapshot: data, fontReferences: edition.managedFontReferences,
  generationRequest: { ...previous.generationRequest, templateVersion: edition.version, templateChecksum: edition.checksum },
  pages: expandTemplatePages(edition.template, buildPresentationModel(data)) };
if (report.pages.length !== 44) throw Error("Expected 44 pages");
await writeFile(output, JSON.stringify(await capturePresentationAssets(report, store)), { flag: "wx" });
console.log(JSON.stringify({ output, pages: report.pages.length, checksum: edition.checksum,
  preservedSourceSha256: createHash("sha256").update(raw).digest("hex"), mapChecksum: data.overallActivityMapChecksum }));
