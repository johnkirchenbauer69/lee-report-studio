import { describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { open } from "yauzl";
import { marketAssetFixture } from "../../tests/support/marketAssetFixture";
import {
  buildExportPlan,
  discoverMarkets,
  fragmentPage,
  tablePayload,
} from "../../src/report-engine/market-assets/discovery";
import {
  CATEGORIES,
  exportRequestSchema,
} from "../../src/report-engine/market-assets/contracts";
import {
  readableName,
  uniqueName,
  assertArchivePath,
} from "../../src/report-engine/market-assets/naming";
import { writeWorkbook, writeNarrative } from "./office";
import {
  capturePresentationAssets,
  freezePresentation,
  sourceHash,
} from "./snapshot";
import { FileSystemAssetStore } from "../assets/assetStore";
import { FileSystemReportInstanceRepository } from "../report-instances/FileSystemReportInstanceRepository";
import { MarketAssetService, validateZip } from "./service";

const request = (reportId: string, markets = ["i55-corridor"]) => ({
  reportId,
  markets,
  categories: Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[],
  resolution: "high" as const,
  transparent: false,
});
const unzip = (bytes: Buffer): Promise<Record<string, string>> =>
  new Promise((resolve, reject) => {
    import("yauzl")
      .then(({ fromBuffer }) =>
        fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
          if (error || !zip) return reject(error);
          const entries: Record<string, string> = {};
          zip.on("entry", (e) =>
            zip.openReadStream(e, (error, stream) => {
              if (error || !stream) return reject(error);
              const chunks: Buffer[] = [];
              stream.on("data", (c) => chunks.push(c));
              stream.on("end", () => {
                entries[e.fileName] = Buffer.concat(chunks).toString();
                zip.readEntry();
              });
            }),
          );
          zip.on("error", reject);
          zip.on("end", () => resolve(entries));
          zip.readEntry();
        }),
      )
      .catch(reject);
  });
describe("saved market asset exports", () => {
  it("keeps native transaction amounts aligned when a saved placeholder is omitted", () => {
    const table = {
      type: "table",
      name: "Top Leases",
      sourcePath: "rows",
      variant: "transactions",
      columns: [
        { path: "party", label: "Tenant" },
        { path: "amount", label: "Size (SF)" },
      ],
    } as import("../../src/types/report").TableElement;
    const market = {
      id: "fixture-market",
      name: "Fixture Market",
      pages: [],
      source: { leasing: [{ sizeSf: 100 }, { sizeSf: 200 }, { sizeSf: 300 }] },
    } as import("../../src/report-engine/market-assets/contracts").MarketSection;
    const result = tablePayload(
      table,
      {
        rows: [
          { party: "-", amount: "100" },
          { party: "Second", amount: "200" },
          { party: "Third", amount: "300" },
        ],
      },
      market,
    );
    expect(result.rows.map((row) => row[1].value)).toEqual([200, 300]);
  });
  it("discovers all actual saved markets and produces the complete eight-category matrix", async () => {
    const instance = await marketAssetFixture(),
      plan = buildExportPlan(
        instance,
        request(instance.id),
        sourceHash(instance),
      );
    expect(discoverMarkets(instance)).toHaveLength(19);
    expect(new Set(plan.assets.map((a) => a.category))).toEqual(
      new Set(Object.keys(CATEGORIES)),
    );
    expect(plan.assets.filter((a) => a.category === "charts")).toHaveLength(4);
    expect(
      plan.assets.filter(
        (a) => a.category === "properties" && a.format === "png",
      ),
    ).toHaveLength(3);
    expect(
      plan.assets.filter((a) => a.category === "section")[0].payload,
    ).toHaveLength(2);
    expect(plan.assets.every((a) => !a.path.includes(instance.id))).toBe(true);
    expect(instance.pages).toHaveLength(44);
    const overall = buildExportPlan(
      instance,
      request(instance.id, ["overall-market"]),
      sourceHash(instance),
    );
    expect(overall.assets).toHaveLength(17);
    expect(
      overall.assets.filter(
        (a) => a.category === "properties" && a.format === "png",
      ),
    ).toHaveLength(3);
    for (const asset of plan.assets.filter((a) => a.format === "png")) {
      const crop = fragmentPage(asset.page!, asset.elements!, false);
      expect(
        crop.elements.every(
          (e) => Number.isFinite(e.x) && Number.isFinite(e.y),
        ),
      ).toBe(true);
    }
  });
  it("reopens all workbooks with native numbers, nulls, percent fractions and three property tables", async () => {
    const instance = await marketAssetFixture(),
      plan = buildExportPlan(
        instance,
        request(instance.id),
        sourceHash(instance),
      );
    for (const asset of plan.assets.filter((a) => a.format === "xlsx")) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await writeWorkbook(asset, plan)) as any);
      expect(workbook.worksheets.length).toBeGreaterThan(0);
      if (asset.category === "indicators") {
        const values: unknown[] = [];
        workbook.worksheets[0].eachRow((r) =>
          r.eachCell((c) => values.push(c.value)),
        );
        expect(values).toContain(0.0509);
        expect(workbook.worksheets[0].getCell("B6").font.bold).toBe(true);
      }
      if (asset.category === "statistics") {
        const values: unknown[] = [];
        workbook
          .getWorksheet("Historical Statistics")!
          .eachRow((r) => r.eachCell((c) => values.push(c.value)));
        expect(values).toContain(-123456);
      }
      if (asset.category === "transactions")
        expect(workbook.worksheets.map((s) => s.name)).toEqual([
          "TopLeases",
          "TopSales",
        ]);
      if (asset.category === "properties") {
        expect(workbook.worksheets).toHaveLength(1);
        expect(
          Object.keys((workbook.worksheets[0] as any).tables),
        ).toHaveLength(3);
      }
      workbook.worksheets.forEach((s) =>
        s.eachRow((r) =>
          r.eachCell((c) => expect(typeof c.value).not.toBe("object")),
        ),
      );
    }
  });
  it("writes editable DOCX paragraphs with source text and no macros or external relationships", async () => {
    const instance = await marketAssetFixture(),
      plan = buildExportPlan(
        instance,
        request(instance.id),
        sourceHash(instance),
      );
    const asset = plan.assets.find((a) => a.format === "docx")!,
      entries = await unzip(await writeNarrative(asset, plan));
    expect(entries["word/document.xml"]).toContain(
      "Saved paragraph two preserves punctuation, spacing, and order.",
    );
    expect(entries["word/document.xml"].match(/<w:p>/g)).toHaveLength(5);
    expect(Object.keys(entries).some((n) => /vba|external/i.test(n))).toBe(
      false,
    );
    expect(Object.values(entries).join(" ")).not.toContain(
      'TargetMode="External"',
    );
  });
  it("retains the saved image and rejects unavailable historical assets rather than using current defaults", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-assets-test-"));
    try {
      const store = new FileSystemAssetStore(root);
      await store.initialize();
      const instance = await marketAssetFixture(),
        page = instance.pages.find((p) => p.geographyId === "i55-corridor")!;
      await expect(freezePresentation(instance, [page], store)).rejects.toThrow(
        "Saved image bytes",
      );
      const captured = await capturePresentationAssets(instance, store);
      expect(captured.presentationAssets!.length).toBeGreaterThan(19);
      const frozen = await freezePresentation(captured, [page], store);
      expect(
        frozen.template.pages[0].elements
          .filter((e) => e.type === "image")
          .every(
            (e) => e.type === "image" && (!e.src || e.src.startsWith("data:")),
          ),
      ).toBe(true);
      captured.presentationAssets![0].checksum = "0".repeat(64);
      await expect(freezePresentation(captured, [page], store)).rejects.toThrow(
        "checksum",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("reports absent narrative and history without manufacturing files or records", async () => {
    const instance = await marketAssetFixture();
    const detail = instance.dataSnapshot.submarketDetails.find((d) =>
      /55/.test(d.name),
    )!;
    detail.historicalPeriods = [];
    detail.narrative = "";
    detail.deliveries = [];
    const plan = buildExportPlan(
      instance,
      request(instance.id),
      sourceHash(instance),
    );
    expect(
      plan.assets.filter(
        (a) => a.category === "narrative" || a.category === "indicators",
      ),
    ).toHaveLength(0);
    expect(plan.warnings.join(" ")).toContain(
      "Market Narrative is not available",
    );
    const property = plan.assets.find(
      (a) => a.category === "properties" && a.format === "xlsx",
    )!;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await writeWorkbook(property, plan)) as any);
    expect(Object.keys((workbook.worksheets[0] as any).tables)).toHaveLength(2);
  });
  it("rejects stale preview, duplicate selections and traversal and completes read-only office jobs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-assets-job-test-"));
    try {
      const repository = new FileSystemReportInstanceRepository(root);
      await repository.initialize();
      const store = new FileSystemAssetStore(root);
      await store.initialize();
      const instance = await repository.create(await marketAssetFixture());
      const service = new MarketAssetService({
        repository,
        store,
        root: path.join(root, "exports"),
        appUrl: "http://127.0.0.1:1",
        renderJobs: new Map(),
        renderPdf: async () => {
          throw new Error("Not used for office exports");
        },
      });
      await service.initialize();
      const selected = {
        ...request(instance.id),
        categories: ["statistics", "narrative"] as const,
      };
      const preview = await service.preview({
        ...selected,
        categories: [...selected.categories],
      });
      await expect(
        service.create({
          ...selected,
          categories: [...selected.categories],
          revision: instance.revision,
          snapshotHash: "0".repeat(64),
        }),
      ).rejects.toThrow("changed after preview");
      const job = await service.create({
        ...selected,
        categories: [...selected.categories],
        revision: preview.revision,
        snapshotHash: preview.snapshotHash,
      });
      for (let i = 0; i < 100 && !service.download(job.id); i++)
        await new Promise((r) => setTimeout(r, 30));
      expect(service.get(job.id)?.state).toBe("completed");
      expect(sourceHash((await repository.get(instance.id))!)).toBe(
        preview.snapshotHash,
      );
      await validateZip(
        service.download(job.id)!.file,
        service.get(job.id)!.manifest!,
        `${preview.root}/ExportManifest.json`,
      );
      const bytes = await readFile(service.download(job.id)!.file);
      bytes[bytes.length - 22] = 0;
      await writeFile(path.join(root, "broken.zip"), bytes);
      await expect(
        validateZip(
          path.join(root, "broken.zip"),
          service.get(job.id)!.manifest!,
          `${preview.root}/ExportManifest.json`,
        ),
      ).rejects.toBeDefined();
      expect(() =>
        buildExportPlan(
          instance,
          request(instance.id, ["i55-corridor", "i55-corridor"]),
          sourceHash(instance),
        ),
      ).toThrow("only once");
      expect(() =>
        exportRequestSchema.parse({
          ...request(instance.id),
          reportId: "../report-x",
        }),
      ).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("sanitizes reserved names and case-insensitive collisions", () => {
    expect(readableName("CON")).toBe("CON Market");
    expect(readableName("CON.txt")).toBe("CON Market.txt");
    expect(readableName("I-80/Joliet Area")).toBe("I-80 - Joliet Area");
    const used = new Set<string>();
    expect(uniqueName("Map.png", used)).toBe("Map.png");
    expect(uniqueName("map.png", used)).toBe("map (2).png");
    for (const p of [
      "../file.png",
      "/file.png",
      "x\\file.png",
      "x/../file.png",
    ])
      expect(() => assertArchivePath(p)).toThrow();
  });
  it("cancels queued work and records interrupted jobs as failed on restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-assets-cancel-test-"));
    try {
      const repository = new FileSystemReportInstanceRepository(root);
      await repository.initialize();
      const store = new FileSystemAssetStore(root);
      await store.initialize();
      const instance = await repository.create(await marketAssetFixture());
      const options = {
        repository,
        store,
        root: path.join(root, "exports"),
        appUrl: "http://127.0.0.1:1",
        renderJobs: new Map(),
        renderPdf: async () => new Uint8Array(),
      };
      const service = new MarketAssetService(options);
      await service.initialize();
      const selected = {
        ...request(instance.id),
        categories: ["narrative"] as (keyof typeof CATEGORIES)[],
      };
      const preview = await service.preview(selected);
      const body = {
        ...selected,
        revision: preview.revision,
        snapshotHash: preview.snapshotHash,
      };
      const first = await service.create(body),
        second = await service.create(body);
      expect((await service.cancel(second.id))?.state).toBe("canceled");
      for (let i = 0; i < 100 && !service.download(first.id); i++)
        await new Promise((r) => setTimeout(r, 20));
      expect(service.get(first.id)?.state).toBe("completed");
      expect(service.download(second.id)).toBeUndefined();
      const interrupted = {
        ...service.get(first.id)!,
        state: "rendering",
        id: "export-12345678-abcd",
      };
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.join(options.root, interrupted.id));
      await writeFile(
        path.join(options.root, interrupted.id, "job.json"),
        JSON.stringify(interrupted),
      );
      const restarted = new MarketAssetService(options);
      await restarted.initialize();
      expect(restarted.get(interrupted.id)?.state).toBe("failed");
      expect(restarted.download(interrupted.id)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
