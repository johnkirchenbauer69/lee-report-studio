import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import { FileSystemTemplateRepository } from "./FileSystemTemplateRepository";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FileSystemTemplateRepository", () => {
  it("creates, saves, reloads, versions, and publishes templates atomically", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-templates-"));
    roots.push(root);
    let tick = 0;
    const repository = new FileSystemTemplateRepository(
      root,
      () => new Date(Date.UTC(2026, 7, 25, 12, 0, tick++)),
    );
    await repository.initialize(sampleTemplate);
    const initial = (await repository.list())[0]!;
    expect(initial).toMatchObject({
      status: "draft",
      version: sampleTemplate.version,
    });

    const saved = await repository.saveDraft(initial.id, initial.version, {
      ...sampleTemplate,
      name: "Refined Industrial Market Report",
    });
    expect((await repository.get(saved.id, saved.version))?.template.name).toBe(
      "Refined Industrial Market Report",
    );
    const reopenedRepository = new FileSystemTemplateRepository(root);
    expect(
      (await reopenedRepository.get(saved.id, saved.version))?.template.name,
    ).toBe("Refined Industrial Market Report");

    const next = await repository.createVersion(saved.id, saved.version);
    expect(next).toMatchObject({
      status: "draft",
      parentVersion: saved.version,
    });
    const published = await repository.publish(next.id, next.version);
    expect(published.status).toBe("published");
    expect((await repository.getPublished(next.id))?.version).toBe(
      next.version,
    );
    await expect(
      repository.saveDraft(next.id, next.version, next.template),
    ).rejects.toThrow("cannot be edited in place");
    expect(
      JSON.parse(
        await readFile(path.join(root, "templates", "templates.json"), "utf8"),
      ),
    ).toHaveLength(2);
  });

  it("retains prior published versions for audit when a successor is published", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-templates-"));
    roots.push(root);
    const repository = new FileSystemTemplateRepository(root);
    await repository.initialize(sampleTemplate);
    const initial = (await repository.list())[0]!;
    await repository.publish(initial.id, initial.version);
    const successor = await repository.createVersion(
      initial.id,
      initial.version,
    );
    await repository.publish(successor.id, successor.version);
    const versions = await repository.listVersions(initial.id);
    expect(
      versions.find((item) => item.version === initial.version)?.status,
    ).toBe("archived");
    expect(
      versions.find((item) => item.version === successor.version)?.status,
    ).toBe("published");
  });

  it("generates from an exact published version/checksum without mutating the stored master", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-templates-"));
    roots.push(root);
    const repository = new FileSystemTemplateRepository(root);
    await repository.initialize(sampleTemplate);
    const initial = (await repository.list())[0]!;
    const published = await repository.publish(initial.id, initial.version);
    const report = await generateReportInstance(published.template, {
      templateId: published.id,
      templateVersion: published.version,
      templateChecksum: published.checksum,
      market: "Chicago",
      period: "2026 Q2",
      calculationScope: { type: "all-submarkets" },
      pageSelection: {},
      source: { provider: "sample" },
    });
    expect(report).toMatchObject({
      templateId: published.id,
      templateVersion: published.version,
      templateChecksum: published.checksum,
    });
    report.pages[0]!.name = "Edited generated report";
    expect(
      (await repository.get(published.id, published.version))?.template.pages[0]
        ?.name,
    ).toBe(sampleTemplate.pages[0]!.name);
  });
});
