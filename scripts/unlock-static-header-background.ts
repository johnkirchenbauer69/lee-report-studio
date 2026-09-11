import "dotenv/config";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { sampleTemplate } from "../src/data/sampleTemplate.ts";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";

/**
 * Applies the same header-background selectability fix now baked into
 * `src/data/sampleTemplate.ts` (see docs/test-storage-isolation.md's
 * sibling — this is the Part B header-editability fix, not the Part A
 * storage-isolation one) to already-persisted **draft** template versions,
 * so it takes effect immediately in an existing local Template Library
 * without waiting for a brand-new template to be created from source.
 *
 * Published/archived versions are immutable by design and are left
 * untouched; create a new draft from one of those to pick up the fix.
 *
 * Usage:
 *   npx tsx scripts/unlock-static-header-background.ts           (dry run)
 *   npx tsx scripts/unlock-static-header-background.ts --apply
 */

const STATIC_PAGE_IDS = [
  "data-methodology",
  "definitions",
  "contacts",
  "who-we-are",
] as const;

const apply = process.argv.includes("--apply");
const dataRoot = path.resolve(process.env.LEE_DATA_DIR ?? "server/data");

async function main() {
  const repository = new FileSystemTemplateRepository(dataRoot);
  const records = await repository.listAll();
  const drafts = records.filter(
    (record) => record.id === sampleTemplate.id && record.status === "draft",
  );

  const changes: Array<{ version: string; pages: string[] }> = [];
  const pendingSaves: Array<() => Promise<unknown>> = [];
  for (const draft of drafts) {
    const changedPages: string[] = [];
    const pages = draft.template.pages.map((page) => {
      if (!STATIC_PAGE_IDS.includes(page.id as (typeof STATIC_PAGE_IDS)[number]))
        return page;
      let changed = false;
      const elements = page.elements.map((element) => {
        if (element.id !== `${page.id}-header-mask` || !element.locked)
          return element;
        changed = true;
        const { locked: _locked, ...rest } = element;
        return rest as typeof element;
      });
      if (changed) changedPages.push(page.id);
      return changed ? { ...page, elements } : page;
    });
    if (!changedPages.length) continue;
    changes.push({ version: draft.version, pages: changedPages });
    if (apply)
      pendingSaves.push(async () =>
        repository.saveDraft(draft.id, draft.version, {
          ...draft.template,
          pages,
        }),
      );
  }

  if (apply && changes.length) {
    const backupRoot = path.join(
      dataRoot,
      ".cleanup-backups",
      `header-unlock-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    await mkdir(backupRoot, { recursive: true });
    await cp(
      path.join(repository.templatesRoot, "templates.json"),
      path.join(backupRoot, "templates.json"),
    );
    console.log(`Backed up templates.json to ${backupRoot}`);
    for (const save of pendingSaves) await save();
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        dataRoot,
        templateId: sampleTemplate.id,
        draftVersionsChanged: changes,
      },
      null,
      2,
    ),
  );
  if (!apply)
    console.log(
      "\nDry run only — nothing was changed. Re-run with --apply to unlock these header backgrounds.",
    );
}

await main();
