import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FontReference, ReportTemplate } from "../../src/types/report.ts";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "../../src/types/templateLibrary.ts";
import type { TemplateRepository } from "./TemplateRepository.ts";

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
const fontReferences = (template: ReportTemplate): FontReference[] =>
  (template.assets ?? []).flatMap((asset) =>
    asset.type === "font" &&
    asset.fontFamily &&
    asset.fontWeight != null &&
    asset.fontStyle &&
    asset.checksum
      ? [
          {
            assetId: asset.id,
            family: asset.fontFamily,
            weight: asset.fontWeight,
            style: asset.fontStyle,
            checksum: asset.checksum,
          },
        ]
      : [],
  );
const summary = (record: StoredTemplateVersion): TemplateVersionSummary => {
  const {
    template: _template,
    assetReferences: _assets,
    managedFontReferences: _fonts,
    ...rest
  } = record;
  return clone(rest);
};

export class FileSystemTemplateRepository implements TemplateRepository {
  readonly templatesRoot: string;
  private readonly manifestPath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataRoot: string,
    private readonly now = () => new Date(),
  ) {
    this.templatesRoot = path.join(dataRoot, "templates");
    this.manifestPath = path.join(this.templatesRoot, "templates.json");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task);
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
    },
  ): StoredTemplateVersion {
    const now = this.now().toISOString();
    const frozen = clone(template);
    return {
      id: frozen.id,
      name: frozen.name,
      templateType: "industrial-market-report",
      version: frozen.version,
      status: input.status,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      publishedAt: input.publishedAt,
      parentVersion: input.parentVersion,
      checksum: checksum(frozen),
      pageDefinitionCount: frozen.pages.length,
      template: frozen,
      assetReferences: (frozen.assets ?? []).map((asset) => asset.id),
      managedFontReferences: fontReferences(frozen),
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

  async saveDraft(id: string, version: string, template: ReportTemplate) {
    return this.enqueue(async () => {
      const records = await this.read();
      const index = records.findIndex(
        (record) => record.id === id && record.version === version,
      );
      if (index < 0) throw new Error("Template version not found.");
      if (records[index]!.status !== "draft")
        throw new Error(
          "Published or archived templates cannot be edited in place.",
        );
      const normalized = { ...clone(template), id, version };
      const saved = this.record(normalized, {
        status: "draft",
        createdAt: records[index]!.createdAt,
        parentVersion: records[index]!.parentVersion,
      });
      records[index] = saved;
      await this.write(records);
      return clone(saved);
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
        { status: "draft", parentVersion: sourceVersion },
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
}
