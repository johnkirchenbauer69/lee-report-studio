import type { StoredTemplateVersion } from "../../src/types/templateLibrary.ts";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import type { StoredAsset } from "../assets/assetStore.ts";

/**
 * Detection and repair logic for the "Phase 1B ..." test-fixture pollution
 * left in `server/data` by `tests/visual/zzz-phase1b-integrity.spec.ts` (and
 * its companion acceptance flows) when the visual suite's mutating API
 * calls landed on a reused, non-isolated dev server instead of a disposable
 * one. See docs/test-storage-isolation.md for the full root-cause writeup
 * and server/config/testStorageGuard.ts for the fix that prevents new
 * pollution going forward.
 *
 * Every predicate here is deliberately narrow (name-prefix / literal
 * fixture-marker matches) rather than a broad heuristic like "orphaned
 * template version" — a report instance whose source template was
 * legitimately deleted by a human is a supported, real feature (see
 * `docs/report-instance-persistence.md`), not pollution.
 */

const FIXTURE_NAME_PREFIX = "Phase 1B ";
const FIXTURE_ASSET_NAME_PATTERN = /^phase1b-/i;
// The "legacy report" acceptance fixture deliberately deletes its
// sourceTemplateSnapshot to simulate a real report whose template metadata
// predates that field, so it cannot be identified by name. It is only
// identifiable by the literal marker element the test itself injects.
const LEGACY_FIXTURE_MARKER_ID = /^legacy-[0-9a-f]{8}-marker$/;
const LEGACY_FIXTURE_MARKER_TEXT = "Legacy report survived its source";

export function isTestOwnedTemplateRecord(
  record: Pick<StoredTemplateVersion, "name">,
): boolean {
  return record.name.startsWith(FIXTURE_NAME_PREFIX);
}

export function isTestOwnedAsset(asset: Pick<StoredAsset, "name">): boolean {
  return FIXTURE_ASSET_NAME_PATTERN.test(asset.name);
}

export function isTestOwnedReportInstance(
  instance: Pick<ReportInstance, "sourceTemplateSnapshot" | "pages">,
): boolean {
  if (instance.sourceTemplateSnapshot?.name?.startsWith(FIXTURE_NAME_PREFIX))
    return true;
  return instance.pages.some((page) =>
    page.elements.some(
      (element) =>
        element.type === "text" &&
        LEGACY_FIXTURE_MARKER_ID.test(element.id) &&
        element.text === LEGACY_FIXTURE_MARKER_TEXT,
    ),
  );
}

export interface PublishedRestoration {
  id: string;
  version: string;
}

/**
 * When a test-fixture version is currently `published`, `publish()` will
 * have archived whatever real version was published immediately before it
 * (see FileSystemTemplateRepository.publish). Removing the fixture leaves
 * the template id with no published version at all unless that real
 * version is restored. This walks back through a chain of fixture publishes
 * (a fixture can itself have archived an earlier fixture) to the nearest
 * surviving, non-removed version and reports it for restoration.
 */
export function resolvePublishedRestorations(
  records: StoredTemplateVersion[],
  isRemoved: (record: StoredTemplateVersion) => boolean,
): PublishedRestoration[] {
  const byId = new Map<string, StoredTemplateVersion[]>();
  for (const record of records) {
    const bucket = byId.get(record.id) ?? [];
    bucket.push(record);
    byId.set(record.id, bucket);
  }

  const restorations: PublishedRestoration[] = [];
  for (const versions of byId.values()) {
    const currentPublished = versions.find((v) => v.status === "published");
    if (!currentPublished || !isRemoved(currentPublished)) continue;

    const visited = new Set<string>();
    let cursor: StoredTemplateVersion | undefined = currentPublished;
    while (cursor && !visited.has(cursor.version)) {
      visited.add(cursor.version);
      const archived = versions.find(
        (v) =>
          v.status === "archived" &&
          v.version !== cursor!.version &&
          v.updatedAt === cursor!.publishedAt,
      );
      if (!archived) break;
      if (!isRemoved(archived)) {
        restorations.push({ id: archived.id, version: archived.version });
        break;
      }
      cursor = archived;
    }
  }
  return restorations;
}
