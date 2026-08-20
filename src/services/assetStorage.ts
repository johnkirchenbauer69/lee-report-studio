import type { Asset } from "../types/report";

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
export interface AssetImportSummary {
  imported: number;
  duplicates: number;
  conflicts: number;
  rejected: string[];
}
export interface AssetImportResult {
  assets: Asset[];
  summary: AssetImportSummary;
}
export interface AssetStorageService {
  upload(files: File[]): Promise<AssetImportResult>;
  list(): Promise<Asset[]>;
  remove(id: string): Promise<void>;
}
const browserAssets = async (files: File[]): Promise<Asset[]> =>
  Promise.all(
    files.map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ""),
      type: /logo/i.test(file.name) ? "logo" : "image",
      mimeType: file.type || "application/octet-stream",
      source: await fileToDataUrl(file),
      createdAt: new Date().toISOString(),
      storage: "browser",
      size: file.size,
    })),
  );

export const assetStorage: AssetStorageService = {
  async upload(files) {
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    try {
      const response = await fetch("/api/assets", { method: "POST", body });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          detail.error ?? `Asset API returned ${response.status}`,
        );
      }
      const result = (await response.json()) as Partial<AssetImportResult> & {
        assets?: Asset[];
      };
      const assets = result.assets ?? [];
      return {
        assets,
        summary: result.summary ?? {
          imported: assets.length,
          duplicates: 0,
          conflicts: 0,
          rejected: [],
        },
      };
    } catch (error) {
      const managed = files.some((file) =>
        /\.(woff2?|ttf|otf|zip)$/i.test(file.name),
      );
      if (managed) throw error;
      console.warn(
        "Asset API unavailable; using browser image storage.",
        error,
      );
      const assets = await browserAssets(files);
      return {
        assets,
        summary: {
          imported: assets.length,
          duplicates: 0,
          conflicts: 0,
          rejected: [],
        },
      };
    }
  },
  async list() {
    const response = await fetch("/api/assets");
    if (!response.ok) throw new Error("Assets could not be loaded.");
    return ((await response.json()) as { assets: Asset[] }).assets;
  },
  async remove(id) {
    const response = await fetch(`/api/assets/${id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404)
      throw new Error("Asset could not be removed.");
  },
};
