import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Durable salesforceId -> assetId map so a Salesforce attachment/file is
 * only ever fetched and imported once. Historical ReportInstances keep
 * pointing at the Studio asset even if the underlying Salesforce
 * attachment later becomes unavailable, without re-fetching Salesforce on
 * every subsequent report generation for the same source image.
 */
export class SalesforceImageIndex {
  private readonly indexPath: string;

  constructor(private readonly dataRoot: string) {
    this.indexPath = path.join(dataRoot, "salesforceImages.json");
  }

  private async load(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.indexPath, "utf8")) as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  }

  async get(salesforceId: string): Promise<string | undefined> {
    const map = await this.load();
    return map[salesforceId];
  }

  async set(salesforceId: string, assetId: string): Promise<void> {
    const map = await this.load();
    map[salesforceId] = assetId;
    await mkdir(this.dataRoot, { recursive: true });
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(map, null, 2), "utf8");
    await rename(temporary, this.indexPath);
  }
}
