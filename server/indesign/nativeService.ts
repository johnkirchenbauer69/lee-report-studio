import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { ZipFile } from "yazl";
import { PDFDocument } from "pdf-lib";
import type { FileSystemReportInstanceRepository } from "../report-instances/FileSystemReportInstanceRepository.ts";
import type { FileSystemAssetStore } from "../assets/assetStore.ts";
import {
  freezePresentation,
  type FrozenPresentation,
} from "../market-assets/snapshot.ts";
import { captureNativeLayout } from "./nativeLayout.ts";
import { prepareDesktopInput } from "./desktopInput.ts";
import { executeDesktopJob } from "./desktopSession.ts";
import { WindowsDesktopSession } from "./windowsDesktopSession.ts";
import { FileDesktopJournal } from "./fileDesktopJournal.ts";
import {
  validateInDesignPackage,
  type InDesignValidation,
} from "./exportContract.ts";

const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export interface NativeJob {
  id: string;
  reportId: string;
  revision: number;
  state: "preparing" | "executing" | "complete" | "failed";
  message: string;
  directory?: string;
  archive?: string;
}
export class NativeExportService {
  private busy = false;
  private jobs = new Map<string, NativeJob>();
  constructor(
    private options: {
      repository: FileSystemReportInstanceRepository;
      store: FileSystemAssetStore;
      root: string;
      dataRoot: string;
      appUrl: string;
      renderJobs: Map<string, FrozenPresentation>;
    },
  ) {}
  get hasPendingWork() {
    return this.busy;
  }
  get(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    const { directory, archive, ...visible } = job;
    return visible;
  }
  download(id: string) {
    const job = this.jobs.get(id);
    return job?.state === "complete" ? job.archive : undefined;
  }
  async create(reportId: string, revision: number) {
    if (this.busy) throw Error("Another native export is running.");
    const report = await this.options.repository.get(reportId);
    if (!report || report.revision !== revision)
      throw Error(
        "Report revision changed. Reopen the saved report before exporting.",
      );
    if (
      !["industrial-market-classic", "industrial-market-geographic"].includes(
        report.templateId,
      )
    )
      throw Error(
        "Native export is available for the canonical report families.",
      );
    if (report.pages.filter((p) => !p.hidden).length !== 44)
      throw Error("Canonical native export requires all 44 pages.");
    if (!report.readiness.canExportDraft)
      throw Error("Resolve report export blockers first.");
    // Reserve synchronously after the asynchronous read as concurrent requests may finish together.
    if (this.busy) throw Error("Another native export is running.");
    this.busy = true;
    const id = randomUUID();
    const job: NativeJob = {
      id,
      reportId,
      revision,
      state: "preparing",
      message: "Freezing saved report and artwork",
    };
    this.jobs.set(id, job);
    void this.run(job, structuredClone(report))
      .catch((error) => {
        job.state = "failed";
        job.message = (error as Error).message;
      })
      .finally(() => {
        this.busy = false;
      });
    return this.get(id)!;
  }
  private async run(
    job: NativeJob,
    report: NonNullable<
      Awaited<ReturnType<FileSystemReportInstanceRepository["get"]>>
    >,
  ) {
    const work = path.join(this.options.root, job.id);
    await mkdir(work, { recursive: true });
    const record = async () =>
      writeFile(
        path.join(work, "status.json"),
        JSON.stringify(this.get(job.id), null, 2),
      );
    try {
      const session = WindowsDesktopSession.operatorStarted();
      const state = await session.inspect();
      if (state.openDocuments.length)
        throw Error(
          "Close all InDesign documents, then start a new export. No documents were changed.",
        );
      const frozen = await freezePresentation(
        report,
        report.pages,
        this.options.store,
      );
      this.options.renderJobs.set(job.id, frozen);
      try {
        await captureNativeLayout(
          frozen,
          `${this.options.appUrl}/?printJob=${job.id}`,
          work,
          (message) => {
            job.message = message;
          },
        );
      } finally {
        this.options.renderJobs.delete(job.id);
      }
      const scriptFile = fileURLToPath(
        new URL("./build-native.jsx", import.meta.url),
      );
      const masterFile = path.join(work, "layout.json");
      const derivedFiles: { file: string; bytes: Buffer }[] = [];
      for (const folder of ["Links", "Document fonts"])
        for (const name of await readdir(path.join(work, folder)))
          derivedFiles.push({
            file: `${folder}/${name}`,
            bytes: await readFile(path.join(work, folder, name)),
          });
      const release = {
        familyId: report.templateId,
        templateVersion: report.templateVersion,
        templateChecksum: report.templateChecksum,
        masterFormat: "json" as const,
        masterSha256: sha(await readFile(masterFile)),
        scriptSha256: sha(await readFile(scriptFile)),
        expectedPages: 44,
      };
      const input = await prepareDesktopInput({
        report,
        release,
        masterFile,
        scriptFile,
        derivedFiles,
        capturedAssetsDirectory: path.join(
          this.options.dataRoot,
          "report-instance-assets",
        ),
        outputRoot: path.join(work, "prepared"),
      });
      job.directory = input.directory;
      job.state = "executing";
      job.message =
        "Creating editable InDesign pages and validating the package";
      await record();
      await executeDesktopJob({
        jobKey: input.manifest.jobKey,
        jobDirectory: input.directory,
        session,
        journal: new FileDesktopJournal(
          path.join(
            os.homedir(),
            "AppData",
            "Local",
            "Lee Report Studio",
            "native-export-journal",
          ),
        ),
        timeoutMs: 15 * 60000,
        operatorStarted: true,
      });
      const validation = JSON.parse(
        await readFile(
          path.join(input.directory, "native-validation.json"),
          "utf8",
        ),
      ) as InDesignValidation;
      validation.qaPdfPages = (
        await PDFDocument.load(
          await readFile(path.join(input.directory, "Report.pdf")),
        )
      ).getPageCount();
      const relocatedPdf = await PDFDocument.load(
        await readFile(
          path.join(input.directory, "Relocation-check", "Report.pdf"),
        ),
      );
      if (relocatedPdf.getPageCount() !== 44)
        throw Error("Relocation PDF page count mismatch");
      const verdict = validateInDesignPackage(validation, 44);
      if (!verdict.accepted) throw Error(verdict.failures.join("; "));
      await writeFile(
        path.join(input.directory, "validation.json"),
        JSON.stringify({ validation, verdict }, null, 2),
      );
      const zip = new ZipFile(),
        archive = path.join(work, "InDesign-package.zip");
      const writing = pipeline(
        zip.outputStream,
        createWriteStream(archive, { flags: "wx" }),
      );
      for (const name of [
        "Report.indd",
        "Report.pdf",
        "report.json",
        "master.json",
        "input.json",
        "build.jsx",
        "validation.json",
      ])
        zip.addFile(path.join(input.directory, name), name);
      for (const folder of ["Links", "Document fonts", "Assets"])
        for (const name of await readdir(path.join(input.directory, folder)))
          zip.addFile(
            path.join(input.directory, folder, name),
            `${folder}/${name}`,
          );
      zip.addBuffer(
        Buffer.from(
          "Open Report.indd with Links and Document fonts alongside it. The PDF was exported by InDesign. IDML is omitted because import validation has not been completed. Native text and tables are editable; charts and maps are linked vector artwork. Frozen report data and checksums are included. Internal organization use only: commercial fonts must not be redistributed publicly. See Document fonts/Font-licenses.txt and OFL.txt.\n",
        ),
        "READ-ME.txt",
      );
      zip.end();
      await writing;
      job.archive = archive;
      job.state = "complete";
      job.message = "Validated portable InDesign package ready";
      await record();
    } catch (error) {
      job.state = "failed";
      job.message = (error as Error).message;
      await record();
      throw error;
    }
  }
}
