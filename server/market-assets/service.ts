import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  stat,
  rename,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { open } from "yauzl";
import { chromium } from "playwright";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import type {
  ExportAsset,
  ExportJob,
  ExportManifest,
  ExportPlan,
  ExportRequest,
} from "../../src/report-engine/market-assets/contracts.ts";
import {
  buildExportPlan,
  discoverMarkets,
  fragmentPage,
} from "../../src/report-engine/market-assets/discovery.ts";
import { assertArchivePath } from "../../src/report-engine/market-assets/naming.ts";
import type { FileSystemReportInstanceRepository } from "../report-instances/FileSystemReportInstanceRepository.ts";
import type { FileSystemAssetStore } from "../assets/assetStore.ts";
import {
  freezePresentation,
  sourceHash,
  sha256,
  type FrozenPresentation,
} from "./snapshot.ts";
import { writeNarrative, writeWorkbook } from "./office.ts";

const TTL = 24 * 60 * 60 * 1000,
  MAX_BYTES = 512 * 1024 * 1024;
const publicPlan = (plan: ExportPlan) => ({
  ...plan,
  warnings: [
    ...new Set([
      ...plan.warnings,
      ...plan.assets.flatMap((asset) =>
        asset.warnings.map((w) => `${asset.market}: ${w}`),
      ),
    ]),
  ],
  assets: plan.assets.map(
    ({ page, elements, payload, text, ...asset }) => asset,
  ),
});
type Options = {
  repository: FileSystemReportInstanceRepository;
  store: FileSystemAssetStore;
  root: string;
  appUrl: string;
  renderJobs: Map<string, FrozenPresentation>;
  renderPdf: (job: FrozenPresentation) => Promise<Uint8Array>;
};
export class MarketAssetService {
  private jobs = new Map<string, ExportJob>();
  private queue: {
    job: ExportJob;
    instance: ReportInstance;
    plan: ExportPlan;
    request: ExportRequest;
  }[] = [];
  private busy = false;
  private reservations = 0;
  constructor(private options: Options) {}
  get hasPendingWork(): boolean {
    return this.busy || this.queue.length > 0 || this.reservations > 0;
  }
  async initialize() {
    await mkdir(this.options.root, { recursive: true });
    const retention = setInterval(
      () => void this.cleanup().catch(() => undefined),
      60 * 60 * 1000,
    );
    retention.unref();
    for (const id of await readdir(this.options.root)) {
      if (!/^export-[a-f0-9-]+$/.test(id)) continue;
      try {
        const job = JSON.parse(
          await readFile(path.join(this.options.root, id, "job.json"), "utf8"),
        ) as ExportJob;
        if (Date.parse(job.expiresAt) <= Date.now()) {
          await rm(path.join(this.options.root, id), {
            recursive: true,
            force: true,
          });
          continue;
        }
        if (
          ![
            "completed",
            "completed_with_warnings",
            "failed",
            "canceled",
          ].includes(job.state)
        ) {
          job.state = "failed";
          job.error =
            "Export interrupted by a server restart. Create a new export.";
        }
        this.jobs.set(id, job);
      } catch {
        /* An incomplete job has no downloadable artifact. */
      }
    }
  }
  async reports() {
    const priority = { published: 0, approved: 1, draft: 2 };
    return (await this.options.repository.list())
      .sort(
        (a, b) =>
          priority[a.status] - priority[b.status] ||
          b.generatedAt.localeCompare(a.generatedAt),
      )
      .map((i) => ({
        id: i.id,
        name: i.dataSnapshot.report.title,
        period: i.dataSnapshot.report.period,
        status: i.status,
        generatedAt: i.generatedAt,
        templateVersion: i.templateVersion,
        revision: i.revision,
      }));
  }
  async report(id: string) {
    const instance = await this.getInstance(id),
      hash = sourceHash(instance);
    return {
      id,
      name: instance.dataSnapshot.report.title,
      period: instance.dataSnapshot.report.period,
      status: instance.status,
      generatedAt: instance.generatedAt,
      templateVersion: instance.templateVersion,
      revision: instance.revision,
      snapshotHash: hash,
      markets: discoverMarkets(instance).map((m) => ({
        id: m.id,
        name: m.name,
        pages: m.pages.length,
      })),
      warning:
        instance.status === "draft"
          ? "This saved report is a draft. Its export remains draft content."
          : undefined,
    };
  }
  private async getInstance(id: string) {
    const instance = await this.options.repository.get(id);
    if (!instance) throw new Error("Saved report not found.");
    return instance;
  }
  private async plan(instance: ReportInstance, request: ExportRequest) {
    const plan = buildExportPlan(instance, request, sourceHash(instance));
    plan.omissions = [];
    const available: ExportAsset[] = [];
    for (const asset of plan.assets) {
      if (asset.format === "png" || asset.format === "pdf") {
        try {
          await freezePresentation(
            instance,
            asset.format === "pdf"
              ? (asset.payload as ReportInstance["pages"])
              : [
                  fragmentPage(
                    asset.page!,
                    asset.elements!,
                    request.transparent,
                  ),
                ],
            this.options.store,
          );
        } catch (e) {
          const reason = (e as Error).message;
          if (/checksum|integrity/.test(reason)) throw e;
          plan.omissions.push({ filename: asset.path, reason });
          plan.warnings.push(
            `${asset.market}: ${asset.title} unavailable. ${reason}`,
          );
          continue;
        }
      }
      available.push(asset);
    }
    plan.assets = available;
    return plan;
  }
  async preview(request: ExportRequest) {
    const instance = await this.getInstance(request.reportId);
    return publicPlan(await this.plan(instance, request));
  }
  async create(
    request: ExportRequest & { revision: number; snapshotHash: string },
  ) {
    const instance = await this.getInstance(request.reportId);
    if (
      request.revision !== instance.revision ||
      request.snapshotHash !== sourceHash(instance)
    )
      throw Object.assign(
        new Error("The saved report changed after preview. Preview it again."),
        { status: 409 },
      );
    if (this.queue.length + Number(this.busy) + this.reservations >= 8)
      throw Object.assign(
        new Error("The export queue is full. Try again after a job completes."),
        { status: 429 },
      );
    this.reservations++;
    try {
      await this.cleanup();
      let disk = 0;
      for (const job of this.jobs.values())
        try {
          disk += (
            await stat(path.join(this.options.root, job.id, "package.zip"))
          ).size;
        } catch {}
      if (disk + MAX_BYTES > 2 * 1024 * 1024 * 1024)
        throw new Error(
          "Export storage is full. Wait for retained exports to expire.",
        );
      const plan = await this.plan(instance, request);
      if (!plan.assets.length)
        throw new Error("No assets are available for this selection.");
      const job: ExportJob = {
        id: `export-${randomUUID()}`,
        state: "queued",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + TTL).toISOString(),
        reportName: plan.reportName,
        zipName: plan.zipName,
        completed: 0,
        total: plan.assets.length,
        warnings: [...plan.warnings],
      };
      this.jobs.set(job.id, job);
      await this.save(job);
      this.queue.push({
        job,
        instance: structuredClone(instance),
        plan,
        request,
      });
      void this.work();
      return job;
    } finally {
      this.reservations--;
    }
  }
  get(id: string) {
    const job = this.jobs.get(id);
    return job && Date.parse(job.expiresAt) > Date.now()
      ? structuredClone(job)
      : undefined;
  }
  async cancel(id: string) {
    const job = this.jobs.get(id);
    if (job && ["queued", "validating", "rendering"].includes(job.state)) {
      job.state = "canceled";
      await this.save(job);
    }
    return this.get(id);
  }
  download(id: string) {
    const job = this.get(id);
    return job && ["completed", "completed_with_warnings"].includes(job.state)
      ? {
          file: path.join(this.options.root, id, "package.zip"),
          name: job.zipName,
        }
      : undefined;
  }
  private async save(job: ExportJob) {
    const dir = path.join(this.options.root, job.id);
    await mkdir(dir, { recursive: true });
    const temporary = path.join(dir, `job-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(job));
    await rename(temporary, path.join(dir, "job.json"));
  }
  private async cleanup() {
    for (const [id, job] of this.jobs)
      if (Date.parse(job.expiresAt) <= Date.now()) {
        await rm(path.join(this.options.root, id), {
          recursive: true,
          force: true,
        });
        this.jobs.delete(id);
      }
  }
  private async work() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) await this.run(this.queue.shift()!);
    } finally {
      this.busy = false;
    }
  }
  private async run({
    job,
    instance,
    plan,
    request,
  }: MarketAssetService["queue"][number]) {
    if (job.state === "canceled") return;
    const started = Date.now(),
      dir = path.join(this.options.root, job.id);
    const manifest: ExportManifest = {
      schemaVersion: "1.0",
      exportedAt: new Date().toISOString(),
      reportName: plan.reportName,
      reportId: instance.id,
      reportingPeriod: plan.period,
      revision: instance.revision,
      snapshotHash: plan.snapshotHash,
      sourceSnapshotHash: instance.sourceSnapshotHash,
      templateVersion: instance.templateVersion,
      templateChecksum: instance.templateChecksum,
      generatedAt: instance.generatedAt,
      selectedMarkets: plan.selectedMarkets,
      selectedCategories: plan.categories,
      files: [],
      omissions: [...(plan.omissions ?? [])],
      warnings: [...plan.warnings],
      status: "completed",
    };
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
      bytesWritten = 0;
    try {
      let retainedBytes = 0;
      for (const existing of this.jobs.values())
        try {
          retainedBytes += (
            await stat(path.join(this.options.root, existing.id, "package.zip"))
          ).size;
        } catch {}
      if (retainedBytes + MAX_BYTES > 2 * 1024 * 1024 * 1024)
        throw new Error(
          "Export storage is full. Wait for retained exports to expire.",
        );
      job.state = "validating";
      await this.save(job);
      if (sourceHash(instance) !== plan.snapshotHash)
        throw new Error("Frozen report integrity failed.");
      // Launch only when a PNG is requested; a charts-only workload never builds PDF.
      if (plan.assets.some((a) => a.format === "png"))
        browser = await chromium.launch({
          headless: true,
          args: ["--font-render-hinting=none"],
        });
      for (const asset of plan.assets) {
        if ((job.state as string) === "canceled") return;
        if (Date.now() - started > 15 * 60 * 1000)
          throw new Error("Export exceeded its 15-minute runtime limit.");
        job.state = "rendering";
        job.current = `${asset.market}: ${asset.title} (${asset.format.toUpperCase()})`;
        await this.save(job);
        try {
          let bytes: Buffer;
          if (asset.format === "xlsx") bytes = await writeWorkbook(asset, plan);
          else if (asset.format === "docx")
            bytes = await writeNarrative(asset, plan);
          else if (asset.format === "pdf") {
            const frozen = await freezePresentation(
              instance,
              asset.payload as ReportInstance["pages"],
              this.options.store,
            );
            bytes = Buffer.from(await this.options.renderPdf(frozen));
            const pdf = await PDFDocument.load(bytes, {
              updateMetadata: false,
            });
            if (
              pdf.getPageCount() !== frozen.template.pages.length ||
              pdf.getProducer() !== "LEE Report Studio Chromium renderer"
            )
              throw new Error(
                "Section PDF page-count or renderer verification failed.",
              );
          } else {
            // Charts preserve the report's transparent plotting canvas by default.
            // Other asset categories retain the user's explicit background option.
            const transparent =
              asset.category === "charts" || request.transparent;
            const page = fragmentPage(
              asset.page!,
              asset.elements!,
              transparent,
            );
            const frozen = await freezePresentation(
              instance,
              [
                {
                  ...asset.page!,
                  background: transparent
                    ? "transparent"
                    : asset.page!.background,
                  elements: asset.elements!,
                },
              ],
              this.options.store,
            );
            const id = randomUUID();
            const targetWidth = request.resolution === "high" ? 2400 : 1200;
            const targetHeight = (targetWidth * page.height) / page.width;
            const cropX = asset.elements![0].x - page.elements[0].x,
              cropY = asset.elements![0].y - page.elements[0].y;
            const viewport = {
              width: Math.ceil(cropX + page.width),
              height: Math.ceil(cropY + page.height),
            };
            if (
              !Number.isFinite(targetHeight) ||
              targetHeight > 16000 ||
              targetHeight * targetWidth > 40_000_000 ||
              viewport.width *
                viewport.height *
                (targetWidth / page.width) ** 2 >
                40_000_000
            )
              throw new Error(
                "Asset dimensions exceed the safe PNG render limit.",
              );
            const context = await browser!.newContext({
              viewport,
              deviceScaleFactor: targetWidth / page.width,
              colorScheme: "light",
              reducedMotion: "reduce",
            });
            this.options.renderJobs.set(id, frozen);
            try {
              await context.route("**/*", (route) => {
                const url = new URL(route.request().url());
                return url.origin === new URL(this.options.appUrl).origin ||
                  ["data:", "blob:"].includes(url.protocol)
                  ? route.continue()
                  : route.abort();
              });
              const tab = await context.newPage();
              await tab.goto(`${this.options.appUrl}/?printJob=${id}`, {
                waitUntil: "networkidle",
              });
              await tab.waitForSelector('[data-render-ready="true"]', {
                timeout: 30_000,
              });
              await tab.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all(
                  [...document.images].map((i) =>
                    i.decode().catch(() => undefined),
                  ),
                );
              });
              const missing = await tab
                .locator(".print-page img")
                .evaluateAll((images) =>
                  images.some((i) => !(i as HTMLImageElement).naturalWidth),
                );
              if (missing) throw new Error("A saved image failed to render.");
              if (transparent)
                await tab.addStyleTag({
                  content:
                    "html,body,#root,.print-document { background:transparent !important; }",
                });
              const origin = await tab.locator(".print-page").boundingBox();
              const x = asset.elements![0].x - page.elements[0].x,
                y = asset.elements![0].y - page.elements[0].y;
              if (
                x < 0 ||
                y < 0 ||
                x + page.width > asset.page!.width + 0.01 ||
                y + page.height > asset.page!.height + 0.01
              )
                throw new Error("Asset exceeds its saved page bounds.");
              bytes = await tab.screenshot({
                clip: {
                  x: origin!.x + x,
                  y: origin!.y + y,
                  width: page.width,
                  height: page.height,
                },
                animations: "disabled",
                omitBackground: transparent,
              });
              const meta = await sharp(bytes).metadata();
              if (!meta.width || Math.abs(meta.width - targetWidth) > 1)
                throw new Error("PNG resolution validation failed.");
              const stats = await sharp(bytes).stats();
              if (stats.channels.slice(0, 3).every((c) => c.stdev < 0.01))
                throw new Error("PNG is blank.");
            } finally {
              await context.close();
              this.options.renderJobs.delete(id);
            }
          }
          bytesWritten += bytes.length;
          if (bytesWritten > MAX_BYTES)
            throw new Error("Export exceeded its 512 MB package limit.");
          await writeFile(path.join(dir, `${asset.id}.${asset.format}`), bytes);
          manifest.files.push({
            filename: asset.path,
            market: asset.market,
            category: asset.category,
            format: asset.format,
            checksum: sha256(bytes),
            bytes: bytes.length,
            warnings: asset.warnings,
          });
          manifest.warnings.push(
            ...asset.warnings.map((w) => `${asset.market}: ${w}`),
          );
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "Asset unavailable.";
          if (/integrity|checksum|512 MB/.test(reason)) throw error;
          manifest.omissions.push({ filename: asset.path, reason });
          manifest.warnings.push(
            `${asset.market}: ${asset.title} omitted. ${reason}`,
          );
        }
        job.completed++;
        job.warnings = [...new Set(manifest.warnings)];
        await this.save(job);
      }
      if ((job.state as string) === "canceled") return;
      if (!manifest.files.length)
        throw new Error(
          "No assets could be reproduced. Review the omissions and select another saved report.",
        );
      job.state = "packaging";
      job.current = "Verifying ZIP inventory and checksums";
      await this.save(job);
      manifest.warnings = [...new Set(manifest.warnings)];
      manifest.status = manifest.warnings.length
        ? "completed_with_warnings"
        : "completed";
      const zip = new ZipFile(),
        zipPath = path.join(dir, "package.zip");
      for (const file of manifest.files) {
        assertArchivePath(file.filename);
        const asset = plan.assets.find((a) => a.path === file.filename)!;
        zip.addFile(
          path.join(dir, `${asset.id}.${asset.format}`),
          file.filename,
        );
      }
      zip.addBuffer(
        Buffer.from(JSON.stringify(manifest, null, 2)),
        `${plan.root}/ExportManifest.json`,
      );
      const writing = pipeline(zip.outputStream, createWriteStream(zipPath));
      zip.end();
      await writing;
      await validateZip(zipPath, manifest, `${plan.root}/ExportManifest.json`);
      job.manifest = manifest;
      job.state = manifest.status;
      job.current = undefined;
      await this.save(job);
    } catch (error) {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : "Export failed.";
      job.manifest = manifest;
      await this.save(job);
    } finally {
      await browser?.close();
      // Keep only downloadable package and metadata, never loose source/export files.
      for (const name of await readdir(dir))
        if (
          /^asset-\d+\.(png|xlsx|docx|pdf)$/.test(name) ||
          (name === "package.zip" &&
            !["completed", "completed_with_warnings"].includes(job.state))
        )
          await rm(path.join(dir, name), { force: true });
    }
  }
}

export function validateZip(
  file: string,
  manifest: ExportManifest,
  manifestPath: string,
): Promise<void> {
  return new Promise((resolve, reject) =>
    open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("ZIP unavailable."));
      const seen = new Set<string>(),
        expected = new Map(manifest.files.map((f) => [f.filename, f]));
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        try {
          assertArchivePath(entry.fileName);
          if (seen.has(entry.fileName.toLowerCase()))
            throw new Error("Duplicate ZIP entry.");
          seen.add(entry.fileName.toLowerCase());
          if (!expected.has(entry.fileName) && entry.fileName !== manifestPath)
            throw new Error("Unexpected ZIP entry.");
        } catch (error) {
          zip.close();
          reject(error);
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(error);
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            const bytes = Buffer.concat(chunks),
              declared = expected.get(entry.fileName);
            if (
              declared &&
              (bytes.length !== declared.bytes ||
                sha256(bytes) !== declared.checksum)
            ) {
              zip.close();
              reject(new Error("ZIP checksum verification failed."));
              return;
            }
            if (
              !declared &&
              JSON.stringify(JSON.parse(bytes.toString())) !==
                JSON.stringify(manifest)
            ) {
              reject(new Error("ZIP manifest validation failed."));
              return;
            }
            zip.readEntry();
          });
        });
      });
      zip.on("end", () =>
        seen.size === manifest.files.length + 1
          ? resolve()
          : reject(new Error("ZIP inventory is incomplete.")),
      );
      zip.readEntry();
    }),
  );
}
