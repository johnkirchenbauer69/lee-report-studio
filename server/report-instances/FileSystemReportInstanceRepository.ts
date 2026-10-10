import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type {
  ManualOverride,
  ReportInstance,
} from "../../src/report-engine/schema/generation.ts";
import {
  normalizeReportInstance,
  serializeReportInstance,
} from "../../src/report-engine/schema/reportInstancePersistence.ts";
import type { ReportPage } from "../../src/types/report.ts";
import { ArtifactIntegrityCoordinator } from "../integrity/ArtifactIntegrityCoordinator.ts";

export interface ReportDocumentPatch {
  baseRevision: number;
  pages: ReportPage[];
  manualOverrides: ManualOverride[];
}

export interface SavedReportSummary {
  id: string; name: string; period: string; status: "draft" | "approved" | "published";
  generatedAt: string; modifiedAt: string; templateVersion: string; revision: number;
}

export interface RepositoryWriteOptions {
  operation?: string;
  expectedRevision?: number;
}

export class ReportInstanceConflictError extends Error {
  readonly code = "REPORT_INSTANCE_CONFLICT";
  constructor(
    readonly reportId: string,
    readonly baseRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Report ${reportId} changed from revision ${baseRevision} to ${currentRevision}. Local edits were not overwritten.`,
    );
    this.name = "ReportInstanceConflictError";
  }
}

export interface ReportInstanceRepository {
  create(instance: ReportInstance): Promise<ReportInstance>;
  save(
    instance: ReportInstance,
    options?: RepositoryWriteOptions,
  ): Promise<ReportInstance>;
  get(id: string): Promise<ReportInstance | null>;
  list(): Promise<ReportInstance[]>;
  update(
    id: string,
    updater: (
      instance: ReportInstance,
    ) => ReportInstance | Promise<ReportInstance>,
    options?: RepositoryWriteOptions,
  ): Promise<ReportInstance>;
  patchDocument(
    id: string,
    patch: ReportDocumentPatch,
  ): Promise<ReportInstance>;
}

const safeId = (id: string) => {
  if (!/^report-[a-zA-Z0-9-]+$/.test(id))
    throw new Error("Invalid report instance identifier.");
  return id;
};

type RepositoryLog = (entry: Record<string, unknown>) => void;

/**
 * One queue per report serializes every operation that can replace its JSON
 * file. Document patches additionally compare the browser's base revision
 * while holding this lock, so the comparison and write are one transaction.
 */
export class FileSystemReportInstanceRepository implements ReportInstanceRepository {
  readonly root: string;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly summaryCache = new Map<string, { stamp: string; summary: SavedReportSummary }>();

  /** Catalog reads do not hydrate and clone every multi-megabyte document at once.
   * File metadata is explicitly labelled as file modification time in the UI.
   * Opening/exporting still uses readCurrent's full schema validation. */
  async summaries(): Promise<SavedReportSummary[]> {
    await this.initialize();
    const names = (await readdir(this.root)).filter(name => /^report-[a-zA-Z0-9-]+\.json$/.test(name));
    const summaries: SavedReportSummary[] = [];
    for (const name of names) {
      const file = path.join(this.root, name), metadata = await stat(file);
      const stamp = `${metadata.mtimeMs}:${metadata.size}`;
      const cached = this.summaryCache.get(name);
      if (cached?.stamp === stamp) { summaries.push(cached.summary); continue; }
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (raw.id !== name.slice(0,-5) || !raw.dataSnapshot?.report || !["draft", "approved", "published"].includes(raw.status) || typeof raw.generatedAt !== "string")
        throw new Error(`Saved report ${name} has invalid catalog metadata. Its file was preserved.`);
      const summary: SavedReportSummary = { id: raw.id, name: raw.dataSnapshot.report.title, period: raw.dataSnapshot.report.period, status: raw.status, generatedAt: raw.generatedAt, modifiedAt: metadata.mtime.toISOString(), templateVersion: raw.templateVersion, revision: raw.revision ?? 0 };
      this.summaryCache.set(name, {stamp, summary}); summaries.push(summary);
    }
    return summaries.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));
  }

  constructor(
    dataRoot: string,
    private readonly logger: RepositoryLog = () => undefined,
    private readonly integrity = new ArtifactIntegrityCoordinator(),
  ) {
    this.root = path.join(dataRoot, "report-instances");
  }

  async initialize() {
    await mkdir(this.root, { recursive: true });
  }

  async deletedIds(): Promise<string[]> {
    try { const metadata = JSON.parse(await readFile(path.join(path.dirname(this.root), "deleted-report-instances.json"), "utf8")); return metadata.ids.filter((id: unknown) => typeof id === "string" && /^report-[a-zA-Z0-9-]+$/.test(id)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  private async assertNotDeleted(id: string) {
    if ((await this.deletedIds()).includes(id)) throw new Error("This legacy report was permanently removed. Recovery cannot recreate it.");
  }

  private file(id: string) {
    return path.join(this.root, `${safeId(id)}.json`);
  }

  private async enqueue<T>(
    id: string,
    operation: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const key = safeId(id);
    let release!: () => void;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = new Promise<void>((resolve) => (release = resolve));
    this.queues.set(key, current);
    await previous;
    try {
      return await this.integrity.runShared(async () => {
        const started = Date.now();
        this.logger({
          event: "report_save_start",
          operation,
          reportId: key,
        });
        try {
          return await task();
        } catch (error) {
          this.logger({
            event:
              error instanceof ReportInstanceConflictError
                ? "report_save_conflict"
                : "report_save_failure",
            operation,
            reportId: key,
            ...(error instanceof ReportInstanceConflictError
              ? {
                  baseRevision: error.baseRevision,
                  currentRevision: error.currentRevision,
                }
              : {}),
            durationMs: Date.now() - started,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          throw error;
        }
      });
    } finally {
      release();
      if (this.queues.get(key) === current) this.queues.delete(key);
    }
  }

  private async readCurrent(id: string): Promise<ReportInstance | null> {
    safeId(id);
    const started = Date.now();
    try {
      const raw = JSON.parse(await readFile(this.file(id), "utf8")) as Record<
        string,
        unknown
      >;
      const legacy =
        raw.schemaVersion === undefined || raw.revision === undefined;
      const instance = normalizeReportInstance(raw);
      if (legacy)
        this.logger({
          event: "report_migration_normalized",
          operation: "read",
          reportId: id,
          schemaVersion: instance.schemaVersion,
          durationMs: Date.now() - started,
        });
      return structuredClone(instance);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      this.logger({
        event: "report_read_failure",
        operation: "read",
        reportId: id,
        durationMs: Date.now() - started,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  }

  private nextRevision(
    instance: ReportInstance,
    current: ReportInstance | null,
  ) {
    return {
      ...instance,
      revision: (current?.revision ?? 0) + 1,
    };
  }

  private assertRevision(
    id: string,
    expectedRevision: number | undefined,
    current: ReportInstance | null,
  ) {
    if (expectedRevision === undefined) return;
    const currentRevision = current?.revision ?? 0;
    if (expectedRevision !== currentRevision)
      throw new ReportInstanceConflictError(
        id,
        expectedRevision,
        currentRevision,
      );
  }

  private async write(instance: ReportInstance) {
    await this.initialize();
    const target = this.file(instance.id);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const serialized = serializeReportInstance(instance);
    // serializeReportInstance validates the exact object before bytes are made.
    try {
      await writeFile(temporary, serialized, "utf8");
      await rename(temporary, target);
      const saved = JSON.parse(serialized) as ReportInstance;
      return structuredClone(saved);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async create(instance: ReportInstance) {
    return this.enqueue(instance.id, "create", async () => {
      await this.assertNotDeleted(instance.id);
      const started = Date.now();
      const current = await this.readCurrent(instance.id);
      if (current)
        throw new ReportInstanceConflictError(
          instance.id,
          instance.revision,
          current.revision,
        );
      const next = await this.write(this.nextRevision(instance, null));
      this.logger({
        event: "report_save_success",
        operation: "create",
        reportId: next.id,
        baseRevision: 0,
        resultingRevision: next.revision,
        durationMs: Date.now() - started,
      });
      return structuredClone(next);
    });
  }

  async save(instance: ReportInstance, options: RepositoryWriteOptions = {}) {
    return this.enqueue(
      instance.id,
      options.operation ?? "replace",
      async () => {
        const started = Date.now();
        await this.assertNotDeleted(instance.id);
        const current = await this.readCurrent(instance.id);
        if (current?.status === "published") throw new Error("Published reports are read-only.");
        this.assertRevision(instance.id, options.expectedRevision, current);
        const next = await this.write(this.nextRevision(instance, current));
        this.logger({
          event: "report_save_success",
          operation: options.operation ?? "replace",
          reportId: next.id,
          baseRevision: current?.revision ?? 0,
          resultingRevision: next.revision,
          durationMs: Date.now() - started,
        });
        return structuredClone(next);
      },
    );
  }

  async get(id: string) {
    return this.readCurrent(id);
  }

  async list() {
    await this.initialize();
    const entries = await readdir(this.root, { withFileTypes: true });
    const ids = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith("report-") &&
          entry.name.endsWith(".json"),
      )
      .map((entry) => entry.name.slice(0, -".json".length))
      .sort();
    const instances = await Promise.all(ids.map((id) => this.readCurrent(id)));
    return instances.filter(
      (instance): instance is ReportInstance => instance !== null,
    );
  }

  async update(
    id: string,
    updater: (
      instance: ReportInstance,
    ) => ReportInstance | Promise<ReportInstance>,
    options: RepositoryWriteOptions = {},
  ) {
    return this.enqueue(id, options.operation ?? "update", async () => {
      const started = Date.now();
      const current = await this.readCurrent(id);
      if (!current) throw new Error("Report instance not found.");
      if (current.status === "published") throw new Error("Published reports are read-only.");
      this.assertRevision(id, options.expectedRevision, current);
      const updated = await updater(current);
      if (updated.id !== id)
        throw new Error(
          "A ReportInstance update cannot change its identifier.",
        );
      if (updated === current) return structuredClone(current);
      const next = await this.write(this.nextRevision(updated, current));
      this.logger({
        event: "report_save_success",
        operation: options.operation ?? "update",
        reportId: id,
        baseRevision: current.revision,
        resultingRevision: next.revision,
        durationMs: Date.now() - started,
      });
      return structuredClone(next);
    });
  }

  async publish(id: string, expectedRevision: number) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("A saved report revision is required.");
    return this.update(id, current => ({ ...current, status: "published", publishedAt: new Date().toISOString() }), { expectedRevision, operation: "publish" });
  }

  async patchDocument(id: string, patch: ReportDocumentPatch) {
    return this.update(
      id,
      (current) => ({
        ...current,
        pages: structuredClone(patch.pages),
        manualOverrides: structuredClone(patch.manualOverrides),
      }),
      {
        expectedRevision: patch.baseRevision,
        operation: "editor_document_patch",
      },
    );
  }
}
