import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateReportInstance } from "../src/report-engine/generation/generateReport.ts";
import { CANONICAL_TEMPLATES } from "../src/report-engine/canonicalTemplates.ts";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
import { FileSystemReportInstanceRepository } from "../server/report-instances/FileSystemReportInstanceRepository.ts";
import { capturePresentationAssets, freezePresentation } from "../server/market-assets/snapshot.ts";
import type { StoredTemplateVersion } from "../src/types/templateLibrary.ts";

// Replay one already-recorded source envelope. This check cannot query Salesforce or generate narratives.
const [fixturePath, outputRoot, dataRoot = "server/data"] = process.argv.slice(2);
if (!fixturePath || !outputRoot) throw new Error("Expected saved source envelope and NEW evidence directory");
await mkdir(outputRoot, { recursive: false });
const fixtureBytes = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(fixtureBytes);
globalThis.fetch = async (url, init) => {
  assert.equal(new URL(String(url)).pathname, "/api/report-data/industrial-market");
  assert.equal(init?.method, "POST");
  return new Response(fixtureBytes, { headers: { "content-type": "application/json" } });
};
const records = JSON.parse(await readFile(path.join(dataRoot, "templates/templates.json"), "utf8")) as StoredTemplateVersion[];
const store = new FileSystemAssetStore(dataRoot);
const repository = new FileSystemReportInstanceRepository(outputRoot);
const evidence = [];
for (const family of CANONICAL_TEMPLATES) {
  const record = records.find(item => item.id === family.id)!;
  assert.ok(record, `Missing ${family.id}`);
  const instance = await generateReportInstance(record.template, {
    templateId: record.id, templateVersion: record.version, templateChecksum: record.checksum,
    market: fixture.report.report.market, period: fixture.report.report.period,
    calculationScope: { type: "all-submarkets" }, pageSelection: {}, source: { provider: "ascendix" },
  });
  assert.equal(instance.pages.length, 44);
  assert.equal(instance.sourceSnapshotId, fixture.snapshot.id);
  assert.equal(instance.sourceSnapshotHash, fixture.snapshot.hash);
  assert.deepEqual(instance.dataSnapshot.overallMarket, { ...fixture.report.overallMarket, narrative: "" });
  assert.deepEqual(instance.dataSnapshot.submarkets, fixture.report.submarkets);
  assert.deepEqual(instance.dataSnapshot.submarketDetails, fixture.report.submarketDetails.map((detail: Record<string, unknown>) => ({ ...detail, narrative: "" })));
  assert.equal(instance.dataSnapshot.submarketDetails.filter(m => m.featuredAvailability?.status === "selected").length,
    fixture.report.submarketDetails.filter((m: { featuredAvailability?: { status: string } }) => m.featuredAvailability?.status === "selected").length);
  const saved = await repository.create(await capturePresentationAssets(instance, store));
  const reopened = await repository.get(saved.id);
  assert.deepEqual(reopened, saved);
  const before = JSON.stringify(reopened);
  const frozen = await freezePresentation(reopened!, reopened!.pages, store);
  assert.equal(JSON.stringify(reopened), before, "Export must not mutate the saved instance");
  assert.equal(frozen.template.pages.length, 44);
  const images = frozen.template.pages.flatMap(page => page.elements.filter(element => element.type === "image" && !element.hidden));
  for (const image of images) if (image.type === "image" && image.src) assert.ok(image.src.startsWith("data:image/"), "Image must be reproducible offline");
  evidence.push({ family: family.id, reportId: saved.id, revision: saved.revision, pages: saved.pages.length,
    assets: saved.presentationAssets?.length, fontResources: saved.fontReferences.length, sourceSnapshotId: saved.sourceSnapshotId,
    sourceSnapshotHash: saved.sourceSnapshotHash, savedReportHash: createHash("sha256").update(before).digest("hex"),
    saveReopenExact: true, exportMutatedSource: false, offlineImages: images.length });
  console.log(JSON.stringify(evidence.at(-1)));
}
await writeFile(path.join(outputRoot, "roundtrip.json"), JSON.stringify({ evidence, scope: "Recorded source replay through production generation/persistence/freezing; no new source queries, narratives, or publication." }, null, 2));
