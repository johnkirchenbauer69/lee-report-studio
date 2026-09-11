import "dotenv/config";
import { cp, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
import { collectPageAssetReferences } from "../server/assets/assetReferences.ts";
import {
  isTestOwnedAsset,
  isTestOwnedReportInstance,
  isTestOwnedTemplateRecord,
  resolvePublishedRestorations,
} from "../server/maintenance/testFixturePollution.ts";
import { FileSystemReportInstanceRepository } from "../server/report-instances/FileSystemReportInstanceRepository.ts";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";

/**
 * One-time, explicit cleanup for the "Phase 1B ..." test-fixture pollution
 * documented in docs/test-storage-isolation.md. Never run automatically
 * (not wired into server startup) — always invoked deliberately, and always
 * dry-run unless --apply is passed.
 *
 * Usage:
 *   npx tsx scripts/clean-test-fixture-pollution.ts             (dry run; logs what would change)
 *   npx tsx scripts/clean-test-fixture-pollution.ts --apply     (backs up, then applies)
 *   npx tsx scripts/clean-test-fixture-pollution.ts --data-dir=path/to/data --apply
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dataDirArg = args
  .find((arg) => arg.startsWith("--data-dir="))
  ?.slice("--data-dir=".length);
const dataRoot = path.resolve(
  dataDirArg ?? process.env.LEE_DATA_DIR ?? "server/data",
);

async function main() {
  const templateRepository = new FileSystemTemplateRepository(dataRoot);
  const reportInstanceRepository = new FileSystemReportInstanceRepository(
    dataRoot,
  );
  const assetStore = new FileSystemAssetStore(dataRoot);
  await reportInstanceRepository.initialize();
  await assetStore.initialize();

  const allTemplateRecords = await templateRepository.listAll();
  const allReportInstances = await reportInstanceRepository.list();
  const allAssets = await assetStore.list();

  const templatesToRemove = allTemplateRecords.filter(isTestOwnedTemplateRecord);
  const removedTemplateKeys = new Set(
    templatesToRemove.map((record) => `${record.id}@${record.version}`),
  );

  const reportsToRemove = allReportInstances.filter(isTestOwnedReportInstance);
  const removedReportIds = new Set(reportsToRemove.map((r) => r.id));

  // Safety check (A1/A4): never remove a template version a *surviving*
  // (non-test-owned) report instance still references.
  const blockedTemplateKeys = new Set<string>();
  for (const instance of allReportInstances) {
    if (removedReportIds.has(instance.id)) continue;
    const key = `${instance.templateId}@${instance.templateVersion}`;
    if (removedTemplateKeys.has(key)) blockedTemplateKeys.add(key);
  }
  const safeTemplatesToRemove = templatesToRemove.filter(
    (record) => !blockedTemplateKeys.has(`${record.id}@${record.version}`),
  );
  const blockedTemplates = templatesToRemove.filter((record) =>
    blockedTemplateKeys.has(`${record.id}@${record.version}`),
  );
  const isRemoved = (record: { id: string; version: string }) =>
    safeTemplatesToRemove.some(
      (removed) => removed.id === record.id && removed.version === record.version,
    );

  const restorations = resolvePublishedRestorations(
    allTemplateRecords,
    isRemoved,
  );

  // Safety check: never remove an asset a surviving template version or
  // surviving report instance still references.
  const survivingTemplates = allTemplateRecords.filter(
    (record) => !isRemoved(record),
  );
  const survivingReports = allReportInstances.filter(
    (instance) => !removedReportIds.has(instance.id),
  );
  // Mirrors AssetReferenceIndex.dependencies: the authoritative signal for
  // "is this asset actually used" is a scan of live page elements, not the
  // template's declared `assets` list.
  const referencedAssetIds = new Set<string>();
  for (const record of survivingTemplates)
    for (const id of collectPageAssetReferences(record.template.pages))
      referencedAssetIds.add(id);
  for (const instance of survivingReports) {
    for (const id of collectPageAssetReferences(instance.pages))
      referencedAssetIds.add(id);
    for (const reference of instance.fontReferences ?? [])
      referencedAssetIds.add(reference.assetId);
  }
  const assetsToRemove = allAssets.filter(
    (asset) => isTestOwnedAsset(asset) && !referencedAssetIds.has(asset.id),
  );
  const blockedAssets = allAssets.filter(
    (asset) => isTestOwnedAsset(asset) && referencedAssetIds.has(asset.id),
  );

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        dataRoot,
        templates: {
          toRemove: safeTemplatesToRemove.map((r) => ({
            id: r.id,
            version: r.version,
            name: r.name,
            status: r.status,
          })),
          blockedByRealReportReference: blockedTemplates.map((r) => ({
            id: r.id,
            version: r.version,
            name: r.name,
          })),
        },
        publishedRestorations: restorations,
        reportInstances: {
          toRemove: reportsToRemove.map((r) => ({
            id: r.id,
            templateVersion: r.templateVersion,
            sourceTemplateSnapshotName: r.sourceTemplateSnapshot?.name,
          })),
        },
        assets: {
          toRemove: assetsToRemove.map((a) => ({ id: a.id, name: a.name })),
          blockedByReference: blockedAssets.map((a) => ({
            id: a.id,
            name: a.name,
          })),
        },
      },
      null,
      2,
    ),
  );

  if (blockedTemplates.length || blockedAssets.length)
    console.warn(
      "Some Phase 1B-named records are still referenced by a non-test-owned " +
        "artifact and were left in place. Review them manually before any " +
        "further action.",
    );

  if (!apply) {
    console.log(
      "\nDry run only — nothing was changed. Re-run with --apply to perform this cleanup.",
    );
    return;
  }
  if (
    !safeTemplatesToRemove.length &&
    !reportsToRemove.length &&
    !assetsToRemove.length
  ) {
    console.log("\nNothing to clean up.");
    return;
  }

  const backupRoot = path.join(
    dataRoot,
    ".cleanup-backups",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(backupRoot, { recursive: true });
  await cp(
    path.join(templateRepository.templatesRoot, "templates.json"),
    path.join(backupRoot, "templates.json"),
  );
  const reportInstancesBackupDir = path.join(backupRoot, "report-instances");
  if (reportsToRemove.length) {
    await mkdir(reportInstancesBackupDir, { recursive: true });
    for (const instance of reportsToRemove)
      await cp(
        path.join(reportInstanceRepository.root, `${instance.id}.json`),
        path.join(reportInstancesBackupDir, `${instance.id}.json`),
      );
  }
  console.log(`\nBacked up affected files to ${backupRoot}`);

  const remainingTemplateRecords = allTemplateRecords
    .filter((record) => !isRemoved(record))
    .map((record) => {
      const restored = restorations.find(
        (r) => r.id === record.id && r.version === record.version,
      );
      return restored ? { ...record, status: "published" as const } : record;
    });
  await templateRepository.adminReplaceAll(remainingTemplateRecords);
  console.log(
    `Removed ${safeTemplatesToRemove.length} template version(s); restored ${restorations.length} to published.`,
  );

  for (const instance of reportsToRemove)
    await unlink(
      path.join(reportInstanceRepository.root, `${instance.id}.json`),
    );
  console.log(`Removed ${reportsToRemove.length} report instance(s).`);

  for (const asset of assetsToRemove)
    await assetStore.remove(asset.id, new Set());
  console.log(`Removed ${assetsToRemove.length} asset(s).`);

  console.log("\nCleanup applied.");
}

await main();
