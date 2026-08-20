import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyFontFace,
  FileSystemAssetStore,
  type StoredAsset,
} from "./assetStore";

const stored = (checksum: string): StoredAsset => ({
  id: checksum,
  name: "Nunito Sans Bold",
  type: "font",
  mimeType: "font/ttf",
  source: `/api/assets/${checksum}/content`,
  createdAt: "2026-08-20T00:00:00.000Z",
  fontFamily: "Nunito Sans",
  fontWeight: 700,
  fontStyle: "normal",
  checksum,
  storage: "backend",
  storageKey: `fonts/organization/${checksum}.ttf`,
});

describe("font asset identity", () => {
  const metadata = {
    family: "Nunito Sans",
    weight: 700,
    style: "normal" as const,
    postScriptName: "NunitoSans-Bold",
  };

  it("skips an exact checksum duplicate", () => {
    expect(classifyFontFace([stored("same")], metadata, "same")).toEqual({
      duplicate: true,
      version: 2,
      outcome: "duplicates",
    });
  });

  it("retains a different binary in the same semantic slot as a new version", () => {
    expect(classifyFontFace([stored("old")], metadata, "new")).toEqual({
      duplicate: false,
      version: 2,
      outcome: "conflicts",
    });
  });

  it("imports a previously unseen face as version one", () => {
    expect(classifyFontFace([], metadata, "new")).toEqual({
      duplicate: false,
      version: 1,
      outcome: "imported",
    });
  });
});

// A minimal 1x1 valid PNG (transparent pixel).
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("FileSystemAssetStore.importBuffer", () => {
  let dataRoot: string;
  let store: FileSystemAssetStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "lee-asset-store-"));
    store = new FileSystemAssetStore(dataRoot);
    await store.initialize();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("stores a valid image buffer with a checksum and a /api/assets/:id/content URL", async () => {
    const asset = await store.importBuffer({
      buffer: PNG_BYTES,
      mimeType: "image/png",
      name: "salesforce-00PVy00000AbCdEfGh",
    });
    expect(asset.mimeType).toBe("image/png");
    expect(asset.checksum).toBe(
      createHash("sha256").update(PNG_BYTES).digest("hex"),
    );
    expect(asset.source).toBe(`/api/assets/${asset.id}/content`);
    const listed = await store.list();
    expect(listed.map((item) => item.id)).toContain(asset.id);
  });

  it("dedupes identical binary content onto the same storage key", async () => {
    const first = await store.importBuffer({
      buffer: PNG_BYTES,
      mimeType: "image/png",
      name: "first.png",
    });
    const second = await store.importBuffer({
      buffer: PNG_BYTES,
      mimeType: "image/png",
      name: "second.png",
    });
    expect(second.storageKey).toBe(first.storageKey);
    expect(second.checksum).toBe(first.checksum);
  });

  it("rejects a disallowed MIME type", async () => {
    await expect(
      store.importBuffer({
        buffer: Buffer.from("not an image"),
        mimeType: "text/html",
        name: "not-an-image.html",
      }),
    ).rejects.toThrow("Unsupported image type.");
  });
});
