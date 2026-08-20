import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Asset } from "../../src/types/report.ts";
import {
  FONT_EXTENSIONS,
  MAX_FONT_BYTES,
  type FontMetadata,
  parseFontMetadata,
  readFontBundle,
} from "./fontImport.ts";

export interface StoredAsset extends Asset {
  storage: "backend";
  storageKey: string;
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  conflicts: number;
  rejected: string[];
}

export function classifyFontFace(
  assets: Pick<
    StoredAsset,
    "type" | "fontFamily" | "fontWeight" | "fontStyle" | "checksum"
  >[],
  metadata: FontMetadata,
  checksum: string,
) {
  const duplicate = assets.some((asset) => asset.checksum === checksum);
  const slotVersions = assets.filter(
    (asset) =>
      asset.type === "font" &&
      asset.fontFamily === metadata.family &&
      asset.fontWeight === metadata.weight &&
      asset.fontStyle === metadata.style,
  ).length;
  return {
    duplicate,
    version: slotVersions + 1,
    outcome: duplicate
      ? ("duplicates" as const)
      : slotVersions
        ? ("conflicts" as const)
        : ("imported" as const),
  };
}

const mimeForExtension = (extension: string) =>
  ({
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  })[extension] ?? "application/octet-stream";

const safeExtension = (fileName: string) =>
  path
    .extname(fileName)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");

export class FileSystemAssetStore {
  readonly assetsRoot: string;
  private readonly manifestPath: string;

  constructor(private readonly dataRoot: string) {
    this.assetsRoot = path.join(dataRoot, "assets");
    this.manifestPath = path.join(dataRoot, "assets.json");
  }

  async initialize() {
    await mkdir(path.join(this.assetsRoot, "fonts", "organization"), {
      recursive: true,
    });
  }

  async list(): Promise<StoredAsset[]> {
    try {
      const stored = JSON.parse(
        await readFile(this.manifestPath, "utf8"),
      ) as Array<StoredAsset & { fileName?: string }>;
      return stored
        .filter((asset) => asset.storageKey || asset.fileName)
        .map(({ fileName, ...asset }) => ({
          ...asset,
          storageKey: asset.storageKey ?? fileName!,
        }));
    } catch {
      return [];
    }
  }

  private async save(assets: StoredAsset[]) {
    await mkdir(this.dataRoot, { recursive: true });
    const temporary = `${this.manifestPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(assets, null, 2), "utf8");
    await rename(temporary, this.manifestPath);
  }

  resolve(asset: StoredAsset): string {
    const resolved = path.resolve(this.assetsRoot, asset.storageKey);
    const root = `${path.resolve(this.assetsRoot)}${path.sep}`;
    if (!resolved.startsWith(root))
      throw new Error("Unsafe asset storage key.");
    return resolved;
  }

  async importUploads(
    files: Express.Multer.File[],
  ): Promise<{ assets: StoredAsset[]; summary: ImportSummary }> {
    const existing = await this.list();
    const created: StoredAsset[] = [];
    const summary: ImportSummary = {
      imported: 0,
      duplicates: 0,
      conflicts: 0,
      rejected: [],
    };
    for (const file of files) {
      try {
        const extension = safeExtension(file.originalname);
        if (extension === ".zip") {
          const bundle = await readFontBundle(file.buffer);
          for (const face of bundle.fonts) {
            const result = await this.importFont(
              face.name,
              face.buffer,
              [...existing, ...created],
              bundle.license,
            );
            if (result.asset) created.push(result.asset);
            summary[result.outcome] += 1;
          }
        } else if (FONT_EXTENSIONS.has(extension)) {
          const result = await this.importFont(file.originalname, file.buffer, [
            ...existing,
            ...created,
          ]);
          if (result.asset) created.push(result.asset);
          summary[result.outcome] += 1;
        } else {
          const asset = await this.importImage(file);
          created.push(asset);
          summary.imported += 1;
        }
      } catch (error) {
        summary.rejected.push(
          `${file.originalname}: ${error instanceof Error ? error.message : "rejected"}`,
        );
      }
    }
    if (created.length) await this.save([...existing, ...created]);
    if (!created.length && summary.rejected.length)
      throw new Error(summary.rejected.join("\n"));
    return { assets: created, summary };
  }

  private async importFont(
    name: string,
    buffer: Buffer,
    assets: StoredAsset[],
    license?: Asset["license"],
  ): Promise<{
    asset?: StoredAsset;
    outcome: "imported" | "duplicates" | "conflicts";
  }> {
    if (buffer.length > MAX_FONT_BYTES)
      throw new Error("Font faces may not exceed 10 MB.");
    const metadata = parseFontMetadata(buffer);
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const classification = classifyFontFace(assets, metadata, checksum);
    if (classification.duplicate) return { outcome: "duplicates" };
    const extension = safeExtension(name);
    const storageKey = path
      .join("fonts", "organization", `${checksum}${extension}`)
      .replace(/\\/g, "/");
    const destination = path.resolve(this.assetsRoot, storageKey);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, buffer, { flag: "wx" }).catch(
      async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const id = randomUUID();
    const asset: StoredAsset = {
      id,
      name: path.parse(name).name,
      type: "font",
      mimeType: mimeForExtension(extension),
      source: `/api/assets/${id}/content`,
      createdAt: new Date().toISOString(),
      fontFamily: metadata.family,
      fontWeight: metadata.weight,
      fontStyle: metadata.style,
      postScriptName: metadata.postScriptName,
      checksum,
      scope: "organization",
      storage: "backend",
      storageKey,
      license,
      version: classification.version,
      size: buffer.length,
    };
    return { asset, outcome: classification.outcome };
  }

  private async importImage(file: Express.Multer.File): Promise<StoredAsset> {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/i.test(file.mimetype))
      throw new Error("Unsupported image type.");
    const extension = safeExtension(file.originalname);
    const id = randomUUID();
    const storageKey = path
      .join("images", `${id}${extension}`)
      .replace(/\\/g, "/");
    const destination = path.resolve(this.assetsRoot, storageKey);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.buffer, { flag: "wx" });
    return {
      id,
      name: path.parse(file.originalname).name,
      type: /logo/i.test(file.originalname) ? "logo" : "image",
      mimeType: file.mimetype,
      source: `/api/assets/${id}/content`,
      createdAt: new Date().toISOString(),
      storage: "backend",
      storageKey,
      size: file.size,
    };
  }

  async remove(id: string): Promise<boolean> {
    const assets = await this.list();
    const asset = assets.find((item) => item.id === id);
    if (!asset) return false;
    await unlink(this.resolve(asset)).catch(() => undefined);
    await this.save(assets.filter((item) => item.id !== id));
    return true;
  }
}
