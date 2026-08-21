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

const extensionForMime = (mimeType: string) =>
  ({
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
  })[mimeType.toLowerCase()] ?? "";

const safeExtension = (fileName: string) =>
  path
    .extname(fileName)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");

const ALLOWED_IMAGE_MIME_TYPES =
  /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i;

export class FileSystemAssetStore {
  readonly assetsRoot: string;
  private readonly manifestPath: string;
  // Serializes every read-modify-write against the manifest file. Without
  // this, concurrent imports (e.g. Promise.all-resolving several Salesforce
  // images for one report) each read the same manifest snapshot, append
  // their own asset, and save -- the last write wins and silently drops
  // every asset imported by the calls in between, leaving orphaned entries
  // in salesforceImageIndex that point at assets which were never saved.
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataRoot: string) {
    this.assetsRoot = path.join(dataRoot, "assets");
    this.manifestPath = path.join(dataRoot, "assets.json");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
    return this.enqueue(() => this.importUploadsLocked(files));
  }

  private async importUploadsLocked(
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
          const asset = await this.importImageBuffer({
            buffer: file.buffer,
            mimeType: file.mimetype,
            originalName: file.originalname,
          });
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

  /**
   * Validates, checksums, and content-addressably stores an image buffer.
   * Shared by the multer upload path (`importUploads`) and any server-side
   * import (e.g. a resolved Salesforce attachment via `importBuffer`), so
   * both go through the same MIME allowlist and dedup-by-checksum storage.
   */
  private async importImageBuffer(input: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
  }): Promise<StoredAsset> {
    if (!ALLOWED_IMAGE_MIME_TYPES.test(input.mimeType))
      throw new Error("Unsupported image type.");
    const checksum = createHash("sha256").update(input.buffer).digest("hex");
    const extension =
      safeExtension(input.originalName) || extensionForMime(input.mimeType);
    const storageKey = path
      .join("images", `${checksum}${extension}`)
      .replace(/\\/g, "/");
    const destination = path.resolve(this.assetsRoot, storageKey);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, input.buffer, { flag: "wx" }).catch(
      async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const id = randomUUID();
    return {
      id,
      name: path.parse(input.originalName).name,
      type: /logo/i.test(input.originalName) ? "logo" : "image",
      mimeType: input.mimeType,
      source: `/api/assets/${id}/content`,
      createdAt: new Date().toISOString(),
      checksum,
      storage: "backend",
      storageKey,
      size: input.buffer.length,
    };
  }

  /**
   * Public server-side import entrypoint for binary content that did not
   * arrive via a multer upload (e.g. a Salesforce attachment fetched and
   * validated by `salesforceImageResolver`). Applies the same MIME
   * allowlist and checksum/dedup storage as uploaded images.
   */
  async importBuffer(input: {
    buffer: Buffer;
    mimeType: string;
    name: string;
  }): Promise<StoredAsset> {
    return this.enqueue(async () => {
      const asset = await this.importImageBuffer({
        buffer: input.buffer,
        mimeType: input.mimeType,
        originalName: input.name,
      });
      const existing = await this.list();
      await this.save([...existing, asset]);
      return asset;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const assets = await this.list();
      const asset = assets.find((item) => item.id === id);
      if (!asset) return false;
      await unlink(this.resolve(asset)).catch(() => undefined);
      await this.save(assets.filter((item) => item.id !== id));
      return true;
    });
  }
}
