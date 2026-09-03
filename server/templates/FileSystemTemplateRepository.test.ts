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

  it("persists structured shadows and image stroke/corners through save and versioning", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-templates-"));
    roots.push(root);
    const repository = new FileSystemTemplateRepository(root);
    const template = structuredClone(sampleTemplate);
    const text = template.pages
      .flatMap((page) => page.elements)
      .find((element) => element.type === "text")!;
    const shape = template.pages
      .flatMap((page) => page.elements)
      .find((element) => element.type === "shape")!;
    const image = template.pages
      .flatMap((page) => page.elements)
      .find((element) => element.type === "image")!;
    text.style.shadow = {
      enabled: true,
      color: "#112233",
      offsetX: 2,
      offsetY: 3,
      blur: 4,
      opacity: 0.25,
    };
    shape.style.shadow = {
      enabled: true,
      color: "#334455",
      offsetX: -2,
      offsetY: 5,
      blur: 7,
      opacity: 0.4,
    };
    image.style.borderRadius = 18;
    image.style.stroke = {
      enabled: true,
      color: "#c4123f",
      width: 4,
      opacity: 1,
      style: "solid",
    };

    await repository.initialize(template);
    const initial = (await repository.list())[0]!;
    await repository.saveDraft(initial.id, initial.version, template);
    const next = await repository.createVersion(initial.id, initial.version);
    const reopened = new FileSystemTemplateRepository(root);
    const versioned = (await reopened.get(next.id, next.version))!.template;

    expect(
      versioned.pages
        .flatMap((page) => page.elements)
        .find((element) => element.id === text.id)?.style.shadow,
    ).toEqual(text.style.shadow);
    expect(
      versioned.pages
        .flatMap((page) => page.elements)
        .find((element) => element.id === shape.id)?.style.shadow,
    ).toEqual(shape.style.shadow);
    expect(
      versioned.pages
        .flatMap((page) => page.elements)
        .find((element) => element.id === image.id)?.style,
    ).toMatchObject({ borderRadius: 18, stroke: image.style.stroke });
  });

  it("deletes only a draft, persists deletion, and leaves other versions and shared assets intact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-templates-"));
    roots.push(root);
    const repository = new FileSystemTemplateRepository(root);
    const seeded = structuredClone(sampleTemplate);
    seeded.assets = [
      {
        id: "shared-font",
        name: "Shared Font",
        type: "font",
        mimeType: "font/otf",
        source: "/api/assets/shared-font/content",
        createdAt: "2026-08-27T00:00:00.000Z",
        fontFamily: "Shared Family",
        fontWeight: 400,
        fontStyle: "normal",
        checksum: "shared-checksum",
        storage: "backend",
      },
    ];
    await repository.initialize(seeded);
    const initial = (await repository.list())[0]!;
    const draft = await repository.createVersion(initial.id, initial.version);
    await repository.deleteDraft(draft.id, draft.version);

    const reopened = new FileSystemTemplateRepository(root);
    expect(await reopened.get(draft.id, draft.version)).toBeUndefined();
    const remaining = await reopened.get(initial.id, initial.version);
    expect(await reopened.listVersions(initial.id)).toHaveLength(1);
    expect(remaining?.assetReferences).toContain("shared-font");
    expect(remaining?.template.assets?.[0]?.id).toBe("shared-font");
    await expect(
      reopened.deleteDraft(initial.id, initial.version),
    ).rejects.toThrow("only remaining template version");
  });

  it("does not delete published versions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-templates-"));
    roots.push(root);
    const repository = new FileSystemTemplateRepository(root);
    await repository.initialize(sampleTemplate);
    const initial = (await repository.list())[0]!;
    const published = await repository.publish(initial.id, initial.version);
    await expect(
      repository.deleteDraft(published.id, published.version),
    ).rejects.toThrow("Only unpublished draft templates");
    expect(await repository.get(published.id, published.version)).toBeDefined();
  });

  it("blocks publishing a new template version that pins a retired font", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-templates-"));
    roots.push(root);
    const repository = new FileSystemTemplateRepository(root);
    const template = structuredClone(sampleTemplate);
    const retired = {
      id: "retired-walrus",
      name: "Walrus",
      type: "font" as const,
      mimeType: "font/ttf",
      source: "/api/assets/retired-walrus/content",
      createdAt: "2026-08-28T00:00:00.000Z",
      fontFamily: "Walrus",
      fontWeight: 400,
      fontStyle: "normal" as const,
      checksum: "retired-checksum",
      fontGovernanceStatus: "retired" as const,
    };
    template.assets = [retired];
    const element = template.pages
      .flatMap((page) => page.elements)
      .find((candidate) => candidate.type === "text")!;
    element.style = {
      ...element.style,
      fontFamily: "Walrus",
      fontWeight: 400,
      fontStyle: "normal",
      fontAssetId: retired.id,
      fontChecksum: retired.checksum,
    };
    await repository.initialize(template);
    const draft = (await repository.list())[0]!;
    await expect(repository.publish(draft.id, draft.version)).rejects.toThrow(
      "non-approved fonts",
    );
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
    const disposableDraft = await repository.createVersion(
      published.id,
      published.version,
    );
    await repository.deleteDraft(disposableDraft.id, disposableDraft.version);
    report.pages[0]!.name = "Edited generated report";
    expect(report.templateChecksum).toBe(published.checksum);
    expect(
      (await repository.get(published.id, published.version))?.template.pages[0]
        ?.name,
    ).toBe(sampleTemplate.pages[0]!.name);
  });
});
