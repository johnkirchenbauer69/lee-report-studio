import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReportTemplate } from "../../src/types/report.ts";
import {
  collectManagedFontReferences,
  findNonApprovedFontUsages,
} from "../../src/services/fontGovernance.ts";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "../../src/types/templateLibrary.ts";
import type { TemplateRepository } from "./TemplateRepository.ts";
import { ArtifactIntegrityCoordinator } from "../integrity/ArtifactIntegrityCoordinator.ts";

const clone = <T>(value: T): T => structuredClone(value);
const checksum = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const compareVersions = (left: string, right: string) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};
const nextVersion = (versions: string[]) => {
  const latest = [...versions].sort(compareVersions).at(-1) ?? "1.0.0";
  const [major = 1, minor = 0] = latest.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
};
const summary = (record: StoredTemplateVersion): TemplateVersionSummary => {
  const {
    template: _template,
    assetReferences: _assets,
    managedFontReferences: _fonts,
    ...rest
  } = record;
  return clone(rest);
};

/**
 * Mirrors ReportInstanceConflictError: a saveDraft call whose
 * `expectedRevision` no longer matches the stored version's current
 * revision means something else (another tab, a teammate, a script) saved
 * over the base the caller was editing from. The caller's edits are never
 * silently discarded — the request is rejected instead.
 */
export class TemplateVersionConflictError extends Error {
  readonly code = "TEMPLATE_VERSION_CONFLICT";
  constructor(
    readonly id: string,
    readonly version: string,
    readonly baseRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Template ${id} v${version} changed from revision ${baseRevision} to ${currentRevision}. Local edits were not overwritten.`,
    );
    this.name = "TemplateVersionConflictError";
  }
}

export class FileSystemTemplateRepository implements TemplateRepository {
  readonly templatesRoot: string;
  private readonly manifestPath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataRoot: string,
    private readonly now = () => new Date(),
    private readonly integrity = new ArtifactIntegrityCoordinator(),
  ) {
    this.templatesRoot = path.join(dataRoot, "templates");
    this.manifestPath = path.join(this.templatesRoot, "templates.json");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const guarded = () => this.integrity.runShared(task);
    const result = this.writeQueue.then(guarded, guarded);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<StoredTemplateVersion[]> {
    try {
      return JSON.parse(
        await readFile(this.manifestPath, "utf8"),
      ) as StoredTemplateVersion[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(records: StoredTemplateVersion[]) {
    await mkdir(this.templatesRoot, { recursive: true });
    const temporary = `${this.manifestPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(records, null, 2), "utf8");
    await rename(temporary, this.manifestPath);
  }

  private record(
    template: ReportTemplate,
    input: {
      status: StoredTemplateVersion["status"];
      createdAt?: string;
      publishedAt?: string;
      parentVersion?: string;
      label?: string;
      revision?: number;
    },
  ): StoredTemplateVersion {
    const now = this.now().toISOString();
    const frozen = clone(template);
    return {
      id: frozen.id,
      name: frozen.name,
      label: input.label,
      templateType: "industrial-market-report",
      version: frozen.version,
      status: input.status,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      publishedAt: input.publishedAt,
      parentVersion: input.parentVersion,
      checksum: checksum(frozen),
      pageDefinitionCount: frozen.pages.length,
      revision: input.revision ?? 1,
      template: frozen,
      assetReferences: (frozen.assets ?? []).map((asset) => asset.id),
      managedFontReferences: collectManagedFontReferences(frozen),
    };
  }

  async initialize(seed?: ReportTemplate) {
    await this.enqueue(async () => {
      await mkdir(this.templatesRoot, { recursive: true });
      const records = await this.read();
      if (records.length || !seed) return;
      await this.write([this.record(seed, { status: "draft" })]);
    });
  }

  async list() {
    return (await this.read())
      .map(summary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listAll() {
    return clone(await this.read());
  }

  async listVersions(id: string) {
    return (await this.read())
      .filter((record) => record.id === id)
      .sort((a, b) => compareVersions(b.version, a.version))
      .map(summary);
  }

  async get(id: string, version: string) {
    const found = (await this.read()).find(
      (record) => record.id === id && record.version === version,
    );
    return found ? clone(found) : undefined;
  }

  async getPublished(id: string) {
    const found = (await this.read())
      .filter((record) => record.id === id && record.status === "published")
      .sort((a, b) => compareVersions(b.version, a.version))[0];
    return found ? clone(found) : undefined;
  }

  async listFontAssetReferences() {
    return new Set(
      (await this.read()).flatMap((record) =>
        collectManagedFontReferences(record.template).map(
          (reference) => reference.assetId,
        ),
      ),
    );
  }

  async saveDraft(
    id: string,
    version: string,
    template: ReportTemplate,
    options: { expectedRevision?: number } = {},
  ) {
    return this.enqueue(async () => {
      const records = await this.read();
      const index = records.findIndex(
        (record) => record.id === id && record.version === version,
      );
      if (index < 0) throw new Error("Template version not found.");
      const current = records[index]!;
      if (current.status !== "draft")
        throw new Error(
          "Published or archived templates cannot be edited in place.",
        );
      if (
        options.expectedRevision !== undefined &&
        options.expectedRevision !== current.revision
      )
        throw new TemplateVersionConflictError(
          id,
          version,
          options.expectedRevision,
          current.revision,
        );
      const normalized = { ...clone(template), id, version };
      const saved = this.record(normalized, {
        status: "draft",
        createdAt: current.createdAt,
        parentVersion: current.parentVersion,
        label: current.label,
        revision: current.revision + 1,
      });
      records[index] = saved;
      await this.write(records);
      return clone(saved);
    });
  }

  /**
   * Pure metadata update — never touches `template`, `checksum`, or
   * `revision`, so it works uniformly on draft, published, and archived
   * versions alike and never conflicts with a concurrent content save.
   */
  async rename(id: string, version: string, label: string) {
    return this.enqueue(async () => {
      const records = await this.read();
      const index = records.findIndex(
        (record) => record.id === id && record.version === version,
      );
      if (index < 0) throw new Error("Template version not found.");
      records[index] = {
        ...records[index]!,
        label: label.trim() || undefined,
      };
      await this.write(records);
      return clone(records[index]!);
    });
  }

  async createVersion(
    id: string,
    sourceVersion: string,
    template?: ReportTemplate,
  ) {
    return this.enqueue(async () => {
      const records = await this.read();
      const source = records.find(
        (record) => record.id === id && record.version === sourceVersion,
      );
      if (!source) throw new Error("Source template version not found.");
      const version = nextVersion(
        records
          .filter((record) => record.id === id)
          .map((record) => record.version),
      );
      const next = this.record(
        {
          ...(template ? clone(template) : clone(source.template)),
          id,
          version,
        },
        { status: "draft", parentVersion: sourceVersion, label: source.label },
      );
      records.push(next);
      await this.write(records);
      return clone(next);
    });
  }

  async publish(id: string, version: string) {
    return this.enqueue(async () => {
      const records = await this.read();
      const index = records.findIndex(
        (record) => record.id === id && record.version === version,
      );
      if (index < 0) throw new Error("Template version not found.");
      if (records[index]!.status !== "draft")
        throw new Error("Only a draft template can be published.");
      const disallowedFonts = findNonApprovedFontUsages(
        records[index]!.template,
      );
      if (disallowedFonts.length)
        throw new Error(
          `Template publication is blocked by non-approved fonts:\n${disallowedFonts
            .map(
              (usage) =>
                `- ${usage.elementName} (${usage.elementId}) uses ${usage.family} [${usage.status}]`,
            )
            .join("\n")}`,
        );
      const publishedAt = this.now().toISOString();
      for (let cursor = 0; cursor < records.length; cursor += 1) {
        const record = records[cursor]!;
        if (record.id === id && record.status === "published")
          records[cursor] = {
            ...record,
            status: "archived",
            updatedAt: publishedAt,
          };
      }
      records[index] = {
        ...records[index]!,
        status: "published",
        publishedAt,
        updatedAt: publishedAt,
      };
      await this.write(records);
      return clone(records[index]!);
    });
  }

  /**
   * Administrative bulk rewrite for one-time offline data-repair tooling
   * (see scripts/clean-test-fixture-pollution.ts). Bypasses the normal
   * draft/published/archived transition checks entirely — the caller is
   * responsible for the replacement set being correct. Intentionally not
   * part of `TemplateRepository`; never call this from an HTTP route or the
   * editor, both of which must keep going through the governed methods
   * above.
   */
  async adminReplaceAll(records: StoredTemplateVersion[]) {
    return this.enqueue(async () => {
      await this.write(clone(records));
    });
  }

  async deleteDraft(id: string, version: string) {
    return this.enqueue(async () => {
      const records = await this.read();
      const index = records.findIndex(
        (record) => record.id === id && record.version === version,
      );
      if (index < 0) throw new Error("Template version not found.");
      if (records[index]!.status !== "draft")
        throw new Error("Only unpublished draft templates can be deleted.");
      if (records.filter((record) => record.id === id).length <= 1)
        throw new Error(
          "The only remaining template version cannot be deleted.",
        );
      records.splice(index, 1);
      await this.write(records);
    });
  }
}
