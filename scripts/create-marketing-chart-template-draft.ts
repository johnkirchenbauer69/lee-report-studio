import "dotenv/config";
import path from "node:path";
import { sampleTemplate } from "../src/data/sampleTemplate.ts";
import { normalizeReportTemplateFonts } from "../src/services/templateNormalization.ts";
import type { ReportElement } from "../src/types/report.ts";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";

const TARGET_IDS = new Set([
  "chart-net",
  "chart-sales-unavailable",
  "availability-chart",
  "construction-chart",
  "detail-chart-net",
  "detail-chart-sales-unavailable",
  "detail-availability-chart",
  "detail-construction-chart",
]);

const dataRoot = path.resolve(process.env.LEE_DATA_DIR ?? "server/data");
const repository = new FileSystemTemplateRepository(dataRoot);
const assetStore = new FileSystemAssetStore(dataRoot);
await assetStore.initialize();
const versions = await repository.listVersions(sampleTemplate.id);
const requestedSourceVersion = process.env.LEE_MARKETING_CHART_SOURCE_VERSION;
const source = requestedSourceVersion
  ? versions.find((version) => version.version === requestedSourceVersion)
  : versions.find((version) => version.status === "published");
if (!source) throw new Error("No Industrial Market Report template exists.");
const stored = await repository.get(sampleTemplate.id, source.version);
if (!stored) throw new Error(`Template ${source.version} could not be loaded.`);

const references = new Map(
  sampleTemplate.pages.flatMap((page) =>
    page.elements
      .filter((element) => TARGET_IDS.has(element.id))
      .map((element) => [element.id, element] as const),
  ),
);
const referenceByName = new Map(
  [...references.values()]
    .filter((element) => !element.id.startsWith("detail-"))
    .map((element) => [element.name, element] as const),
);
const changed: string[] = [];
const migrated = structuredClone(stored.template);
migrated.pages = migrated.pages.map((page) => ({
  ...page,
  elements: page.elements.map((existing): ReportElement => {
    const reference =
      references.get(existing.id) ??
      (existing.type === "image"
        ? referenceByName.get(existing.name)
        : undefined);
    if (!reference) return existing;
    changed.push(`${page.id}:${existing.id}`);
    return {
      ...structuredClone(reference),
      id: existing.id,
      x: existing.x,
      y: existing.y,
      width: existing.width,
      height: existing.height,
      rotation: existing.rotation,
      locked: existing.locked,
      hidden: existing.hidden,
    } as ReportElement;
  }),
}));
if (changed.length !== 8)
  throw new Error(
    `Expected 8 Overall/submarket chart targets; found ${changed.length}: ${changed.join(", ")}`,
  );

const normalized = normalizeReportTemplateFonts(
  migrated,
  (await assetStore.list()).filter(
    (asset) => asset.type === "font" && asset.fontFamily,
  ),
);
const draft = await repository.createVersion(
  sampleTemplate.id,
  source.version,
  normalized,
);
console.log(
  JSON.stringify(
    {
      sourceVersion: source.version,
      draftVersion: draft.version,
      status: draft.status,
      changed,
    },
    null,
    2,
  ),
);
