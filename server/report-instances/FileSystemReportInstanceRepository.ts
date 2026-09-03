import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";

export interface ReportInstanceRepository {
  save(instance: ReportInstance): Promise<ReportInstance>;
  get(id: string): Promise<ReportInstance | null>;
  update(
    id: string,
    updater: (instance: ReportInstance) => ReportInstance | Promise<ReportInstance>,
  ): Promise<ReportInstance>;
}
const safeId = (id: string) => {
  if (!/^report-[a-zA-Z0-9-]+$/.test(id))
    throw new Error("Invalid report instance identifier.");
  return id;
};

export class FileSystemReportInstanceRepository
  implements ReportInstanceRepository
{
  readonly root: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(dataRoot: string) {
    this.root = path.join(dataRoot, "report-instances");
  }

  async initialize() {
    await mkdir(this.root, { recursive: true });
  }

  private file(id: string) {
    return path.join(this.root, `${safeId(id)}.json`);
  }

  async save(instance: ReportInstance) {
    if (!instance.id || !Array.isArray(instance.narratives))
      throw new Error("A valid narrative-enabled ReportInstance is required.");
    await this.initialize();
    const target = this.file(instance.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(instance, null, 2), "utf8");
    await rename(temporary, target);
    return structuredClone(instance);
  }

  async get(id: string) {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as ReportInstance;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async update(
    id: string,
    updater: (instance: ReportInstance) => ReportInstance | Promise<ReportInstance>,
  ) {
    let release!: () => void;
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = new Promise<void>((resolve) => (release = resolve));
    this.locks.set(id, current);
    await previous;
    try {
      const instance = await this.get(id);
      if (!instance) throw new Error("Report instance not found.");
      return await this.save(await updater(instance));
    } finally {
      release();
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }
}
