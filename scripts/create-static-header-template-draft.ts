import "dotenv/config";
import path from "node:path";
import { sampleTemplate } from "../src/data/sampleTemplate.ts";
import { normalizeReportTemplateFonts } from "../src/services/templateNormalization.ts";
import type { ReportElement, ReportPage } from "../src/types/report.ts";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";

const PAGE_IDS = ["data-methodology", "definitions", "contacts"] as const;
const dataRoot = path.resolve(process.env.LEE_DATA_DIR ?? "server/data");
const targetVersion = process.env.LEE_STATIC_HEADER_TARGET_VERSION ?? "1.7.0";
const repository = new FileSystemTemplateRepository(dataRoot);
const assetStore = new FileSystemAssetStore(dataRoot);
await assetStore.initialize();

const referencePages = new Map(
  sampleTemplate.pages
    .filter((page) => PAGE_IDS.includes(page.id as (typeof PAGE_IDS)[number]))
    .map((page) => [page.id, page]),
);

const migratePage = (page: ReportPage): ReportPage => {
  const reference = referencePages.get(page.id);
  if (!reference) return page;
  const governedIds = new Set(
    reference.elements
      .filter((element) => element.id !== `${page.id}-artwork`)
      .map((element) => element.id),
  );
  const artwork = page.elements.filter(
    (element) => element.id === `${page.id}-artwork`,
  );
  const preserved = page.elements.filter(
    (element) =>
      element.id !== `${page.id}-artwork` && !governedIds.has(element.id),
  );
  const nativeHeader = reference.elements.filter(
    (element) => element.id !== `${page.id}-artwork`,
  );
  const mask = nativeHeader.filter((element) =>
    element.id.endsWith("-header-mask"),
  );
  const editable = nativeHeader.filter(
    (element) => !element.id.endsWith("-header-mask"),
  );
  return {
    ...page,
    elements: [...artwork, ...mask, ...preserved, ...editable].map(
      (element) => structuredClone(element) as ReportElement,
    ),
  };
};

const versions = await repository.listVersions(sampleTemplate.id);
const existingTarget = versions.find(
  (version) => version.version === targetVersion,
);
if (existingTarget && existingTarget.status !== "draft")
  throw new Error(
    `Refusing to mutate v${targetVersion}: it is ${existingTarget.status}. Set LEE_STATIC_HEADER_TARGET_VERSION to the safe next version.`,
  );

const requestedSource = process.env.LEE_STATIC_HEADER_SOURCE_VERSION;
const sourceSummary = existingTarget
  ? existingTarget
  : requestedSource
    ? versions.find((version) => version.version === requestedSource)
    : [...versions]
        .filter((version) => version.version !== targetVersion)
        .sort((left, right) => right.version.localeCompare(left.version))[0];
if (!sourceSummary) throw new Error("No source template version exists.");
const source = await repository.get(sampleTemplate.id, sourceSummary.version);
if (!source)
  throw new Error(`Template v${sourceSummary.version} could not be loaded.`);

const assets = await assetStore.list();
const migrated = normalizeReportTemplateFonts(
  {
    ...structuredClone(source.template),
    pages: source.template.pages.map(migratePage),
  },
  assets,
);
const saved = existingTarget
  ? await repository.saveDraft(sampleTemplate.id, targetVersion, migrated)
  : await repository.createVersion(
      sampleTemplate.id,
      sourceSummary.version,
      migrated,
    );
if (saved.version !== targetVersion) {
  if (!existingTarget)
    await repository.deleteDraft(sampleTemplate.id, saved.version);
  throw new Error(
    `The repository allocated v${saved.version}, not requested v${targetVersion}; no published version was mutated.`,
  );
}

console.log(
  JSON.stringify(
    {
      sourceVersion: sourceSummary.version,
      targetVersion: saved.version,
      status: saved.status,
      pages: PAGE_IDS.map((id) => ({
        id,
        elements: saved.template.pages
          .find((page) => page.id === id)
          ?.elements.map((element) => element.id),
      })),
    },
    null,
    2,
  ),
);
