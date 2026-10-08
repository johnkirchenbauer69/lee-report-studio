import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import type {
  Asset,
  ReportTemplate,
  ReportPage,
} from "../../src/types/report.ts";
import type { FileSystemAssetStore } from "../assets/assetStore.ts";
import { resolveContextPath } from "../../src/engine/bindings.ts";
import { snapshotPresentation } from "../../src/report-engine/market-assets/discovery.ts";

export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const pinnedRoot = (store: FileSystemAssetStore) =>
  path.join(path.dirname(store.assetsRoot), "report-instance-assets");
export const sourceHash = (instance: ReportInstance) =>
  sha256(JSON.stringify(instance));
const mime = (source: string) =>
  ({
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  })[path.extname(source).toLowerCase()] ?? "application/octet-stream";
function sources(value: unknown, found = new Set<string>()) {
  if (
    typeof value === "string" &&
    /^(data:image\/|\/report-assets\/|\/assets\/|\/api\/assets\/)/.test(value)
  )
    found.add(value);
  else if (Array.isArray(value)) value.forEach((v) => sources(v, found));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => sources(v, found));
  return found;
}

/** Called only for a new save. Never backfills an older report during export. */
export async function capturePresentationAssets(
  instance: ReportInstance,
  store: FileSystemAssetStore,
) {
  const captured: NonNullable<ReportInstance["presentationAssets"]> = [];
  const stored = await store.list();
  await mkdir(pinnedRoot(store), { recursive: true });
  const urls = sources(instance.pages);
  instance.fontReferences.forEach((ref) => {
    const asset = stored.find(
      (a) => a.id === ref.assetId && a.checksum === ref.checksum,
    );
    if (asset) urls.add(asset.source);
  });
  let total = 0;
  for (const source of urls) {
    if (captured.length >= 250) break;
    try {
      let bytes: Buffer, mimeType: string;
      if (source.startsWith("data:")) {
        const match = source.match(
          /^data:(image\/[a-z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/i,
        );
        if (!match) continue;
        bytes = Buffer.from(match[2], "base64");
        mimeType = match[1];
      } else if (source.startsWith("/api/assets/")) {
        const asset = stored.find((a) => a.source === source);
        if (!asset) continue;
        bytes = await readFile(store.resolve(asset));
        mimeType = asset.mimeType;
        if (asset.checksum !== sha256(bytes)) continue;
      } else {
        const root = path.resolve("public");
        const file = path.resolve(root, `.${source}`);
        if (!file.startsWith(root + path.sep)) continue;
        bytes = await readFile(file);
        mimeType = mime(source);
      }
      if (
        bytes.length > 16 * 1024 * 1024 ||
        total + bytes.length > 64 * 1024 * 1024
      )
        continue;
      total += bytes.length;
      const checksum = sha256(bytes),
        destination = path.join(pinnedRoot(store), checksum);
      const temporary = path.join(
        pinnedRoot(store),
        `capture-${randomUUID()}.tmp`,
      );
      await writeFile(temporary, bytes);
      await rename(temporary, destination);
      captured.push({ source, checksum, mimeType, storageKey: checksum });
    } catch {
      /* Missing historical/local assets are explicitly omitted at export. */
    }
  }
  return { ...instance, presentationAssets: captured };
}

export interface FrozenPresentation {
  template: ReportTemplate;
  data: unknown;
  manualOverrides: ReportInstance["manualOverrides"];
  title: string;
}
export async function freezePresentation(
  instance: ReportInstance,
  pages: ReportPage[],
  store: FileSystemAssetStore,
): Promise<FrozenPresentation> {
  const pinned = new Map<string, string>();
  let total = 0;
  for (const asset of instance.presentationAssets ?? []) {
    if (
      !/^[a-f0-9]{64}$/.test(asset.storageKey) ||
      asset.storageKey !== asset.checksum
    )
      throw new Error("Captured presentation asset checksum/key failed.");
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(pinnedRoot(store), asset.storageKey));
    } catch {
      throw new Error(
        "Captured presentation bytes are unavailable in this installation.",
      );
    }
    total += bytes.length;
    if (total > 64 * 1024 * 1024 || sha256(bytes) !== asset.checksum)
      throw new Error("Captured presentation asset checksum failed.");
    pinned.set(
      asset.source,
      `data:${asset.mimeType};base64,${bytes.toString("base64")}`,
    );
  }
  // Existing immutable asset-store bytes are usable only when their checksum is
  // recorded in the report. No lookup of a current template or default map.
  const stored = await store.list();
  const fonts: Asset[] = [];
  for (const ref of instance.fontReferences) {
    const asset = stored.find(
      (a) => a.id === ref.assetId && a.checksum === ref.checksum,
    );
    if (!asset)
      throw new Error(`Saved font unavailable: ${ref.family} ${ref.weight}.`);
    let url = pinned.get(asset.source);
    if (!url) {
      const bytes = await readFile(store.resolve(asset));
      if (sha256(bytes) !== ref.checksum)
        throw new Error("Saved font checksum failed.");
      url = `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
      pinned.set(asset.source, url);
    }
    fonts.push({ ...asset, source: url });
  }
  const replace = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") {
      if (key === "src" && value) {
        const resolved =
          pinned.get(value) ??
          (value.startsWith("data:image/") ? value : undefined);
        if (!resolved)
          throw new Error(
            "Saved image bytes are unavailable. This older report cannot reproduce this asset.",
          );
        if (resolved.startsWith("data:image/svg+xml")) {
          const separator = resolved.indexOf(","),
            header = resolved.slice(0, separator),
            content = resolved.slice(separator + 1);
          const svg = /;base64/i.test(header)
            ? Buffer.from(content, "base64").toString("utf8")
            : decodeURIComponent(content);
          const references = [
            ...svg.matchAll(
              /(?:href|src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi,
            ),
          ];
          if (
            references.some(
              (match) => !/^(#|data:)/i.test((match[1] ?? match[2]).trim()),
            )
          )
            throw new Error(
              "Saved SVG references an external resource and cannot be reproduced offline.",
            );
        }
        return resolved;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => replace(v));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, replace(v, key)]),
      );
    return value;
  };
  const frozenPages = replace(pages) as ReportPage[];
  // Bindings in the saved pages can reference images in the frozen data model.
  // Only those bindings' bytes are needed, not unrelated omitted property images.
  const data = snapshotPresentation(instance);
  for (const page of frozenPages)
    for (const element of page.elements) {
      if (element.type !== "image" || !element.binding) continue;
      const segments = resolveContextPath(
        element.binding.path,
        element.bindingContext,
      )
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".");
      let node: any = data;
      for (const segment of segments.slice(0, -1)) {
        if (!node || !(segment in node)) {
          node = undefined;
          break;
        }
        node = node[segment];
      }
      if (node) node[segments.at(-1)!] = element.src;
    }
  const template = {
    id: instance.templateId,
    name: instance.sourceTemplateSnapshot?.name ?? "Saved report",
    version: instance.templateVersion,
    pages: frozenPages,
    assets: fonts,
    settings: instance.sourceTemplateSnapshot?.settings,
  } as ReportTemplate;
  return {
    template,
    data,
    manualOverrides: instance.manualOverrides,
    title: instance.dataSnapshot.report.title,
  };
}
