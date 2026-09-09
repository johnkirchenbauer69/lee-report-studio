import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate.ts";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport.ts";
import {
  normalizeReportInstance,
  ReportInstanceValidationError,
} from "../../src/report-engine/schema/reportInstancePersistence.ts";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import {
  FileSystemReportInstanceRepository,
  ReportInstanceConflictError,
} from "./FileSystemReportInstanceRepository.ts";

let root = "";
let repository: FileSystemReportInstanceRepository;
let instance: ReportInstance;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lee-report-instances-"));
  repository = new FileSystemReportInstanceRepository(root);
  instance = await generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FileSystemReportInstanceRepository", () => {
  it("persists edited pages and manual overrides across a new repository process", async () => {
    const created = await repository.create(instance);
    const pages = structuredClone(created.pages);
    pages[0]!.name = "Durably edited page";
    const saved = await repository.patchDocument(created.id, {
      baseRevision: created.revision,
      pages,
      manualOverrides: [
        {
          elementId: "headline",
          bindingPath: "overallMarket.inventorySf",
          generatedValue: 1,
          overrideValue: 2,
          createdAt: "2026-09-08T10:00:00.000Z",
        },
      ],
    });

    const reopened = await new FileSystemReportInstanceRepository(root).get(
      created.id,
    );
    expect(reopened?.revision).toBe(saved.revision);
    expect(reopened?.pages[0]!.name).toBe("Durably edited page");
    expect(reopened?.manualOverrides[0]!.overrideValue).toBe(2);
  });

  it("serializes rapid overlapping writers without ENOENT or corrupt JSON", async () => {
    const created = await repository.create(instance);
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        repository.update(created.id, (current) => ({
          ...current,
          manualOverrides: [
            ...current.manualOverrides,
            {
              elementId: `element-${index}`,
              generatedValue: index,
              overrideValue: index + 1,
              createdAt: "2026-09-08T10:00:00.000Z",
            },
          ],
        })),
      ),
    );

    const saved = await repository.get(created.id);
    expect(saved?.manualOverrides).toHaveLength(40);
    expect(saved?.revision).toBe(created.revision + 40);
    expect(saved?.manualOverrides.map((item) => item.elementId).sort()).toEqual(
      Array.from({ length: 40 }, (_, index) => `element-${index}`).sort(),
    );
    expect(
      (await readdir(repository.root)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  }, 15_000);

  it("does not globally serialize writes to different report IDs", async () => {
    const second = {
      ...structuredClone(instance),
      id: `report-${crypto.randomUUID()}`,
    };
    const [firstCreated, secondCreated] = await Promise.all([
      repository.create(instance),
      repository.create(second),
    ]);
    let entered = 0;
    let release!: () => void;
    let bothEntered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve) => (bothEntered = resolve));
    const updater = async (current: ReportInstance) => {
      entered += 1;
      if (entered === 2) bothEntered();
      await gate;
      return current;
    };
    const writes = [
      repository.update(firstCreated.id, updater),
      repository.update(secondCreated.id, updater),
    ];
    await Promise.race([
      ready,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Different report IDs were globally queued.")),
          1_000,
        ),
      ),
    ]);
    release();
    await Promise.all(writes);
    expect(entered).toBe(2);
  });

  it("cleans failed temporary writes, releases the queue, and allows retry", async () => {
    await repository.initialize();
    const target = path.join(repository.root, `${instance.id}.json`);
    await mkdir(target);
    await expect(repository.create(instance)).rejects.toBeTruthy();
    expect(
      (await readdir(repository.root)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    await rm(target, { recursive: true, force: true });
    const retried = await repository.create(instance);
    await expect(
      repository.update(retried.id, () => {
        throw new Error("Synthetic updater failure");
      }),
    ).rejects.toThrow("Synthetic updater failure");
    expect((await repository.get(retried.id))?.status).toBe("draft");
    const recovered = await repository.update(retried.id, (current) => ({
      ...current,
      status: "approved",
    }));
    expect(recovered.revision).toBe(retried.revision + 1);
    expect(recovered.status).toBe("approved");
  });

  it("rejects a stale document writer and leaves the accepted edit intact", async () => {
    const created = await repository.create(instance);
    const firstPages = structuredClone(created.pages);
    firstPages[0]!.name = "First client";
    const secondPages = structuredClone(created.pages);
    secondPages[0]!.name = "Stale second client";
    const accepted = await repository.patchDocument(created.id, {
      baseRevision: created.revision,
      pages: firstPages,
      manualOverrides: [],
    });

    await expect(
      repository.patchDocument(created.id, {
        baseRevision: created.revision,
        pages: secondPages,
        manualOverrides: [],
      }),
    ).rejects.toMatchObject({
      code: "REPORT_INSTANCE_CONFLICT",
      baseRevision: created.revision,
      currentRevision: accepted.revision,
    });
    expect((await repository.get(created.id))?.pages[0]!.name).toBe(
      "First client",
    );
  });

  it("preserves both narrative and editor changes or returns an explicit conflict", async () => {
    const created = await repository.create(instance);
    const narrativeWrite = repository.update(created.id, (current) => ({
      ...current,
      narratives: current.narratives.map((narrative, index) =>
        index === 0
          ? { ...narrative, text: "Narrative saved concurrently" }
          : narrative,
      ),
    }));
    const documentWrite = repository.patchDocument(created.id, {
      baseRevision: created.revision,
      pages: created.pages.map((page, index) =>
        index === 0 ? { ...page, name: "Concurrent editor page" } : page,
      ),
      manualOverrides: [],
    });
    const results = await Promise.allSettled([narrativeWrite, documentWrite]);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      ReportInstanceConflictError,
    );

    const afterNarrative = (await repository.get(created.id))!;
    const afterEditor = await repository.patchDocument(created.id, {
      baseRevision: afterNarrative.revision,
      pages: afterNarrative.pages.map((page, index) =>
        index === 0 ? { ...page, name: "Concurrent editor page" } : page,
      ),
      manualOverrides: [],
    });
    expect(afterEditor.narratives[0]!.text).toBe(
      "Narrative saved concurrently",
    );
    expect(afterEditor.pages[0]!.name).toBe("Concurrent editor page");
  });

  it("normalizes known legacy metadata but rejects invalid stored business data", async () => {
    const legacy = structuredClone(instance) as unknown as Record<
      string,
      unknown
    >;
    delete legacy.schemaVersion;
    delete legacy.revision;
    delete legacy.manualOverrides;
    delete legacy.fontReferences;
    const normalized = normalizeReportInstance(legacy);
    expect(normalized).toMatchObject({
      schemaVersion: 1,
      revision: 0,
      manualOverrides: [],
      fontReferences: [],
    });
    expect(() =>
      normalizeReportInstance({ ...instance, schemaVersion: 2 }),
    ).toThrow(ReportInstanceValidationError);

    await repository.initialize();
    await writeFile(
      path.join(repository.root, `${instance.id}.json`),
      JSON.stringify({ id: instance.id, narratives: [] }),
      "utf8",
    );
    await expect(repository.get(instance.id)).rejects.toBeInstanceOf(
      ReportInstanceValidationError,
    );
  });
});
