import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    subfamily: "Bold",
    widthClass: 5,
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

  it("does not lose entries when multiple imports run concurrently (Promise.all)", async () => {
    // Regression test: mapHistoricalContributors resolves several
    // Salesforce images in parallel via Promise.all. Without a write
    // queue, each importBuffer() call reads the same manifest snapshot,
    // appends its own asset, and saves -- the last write wins and
    // silently drops every asset imported by calls in between.
    const distinctBuffers = Array.from({ length: 8 }, (_, index) =>
      Buffer.concat([PNG_BYTES, Buffer.from([index])]),
    );
    const imported = await Promise.all(
      distinctBuffers.map((buffer, index) =>
        store.importBuffer({
          buffer,
          mimeType: "image/png",
          name: `concurrent-${index}.png`,
        }),
      ),
    );
    const listed = await store.list();
    for (const asset of imported)
      expect(listed.map((item) => item.id)).toContain(asset.id);
    expect(listed).toHaveLength(imported.length);
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

  it("physically deletes an unused unverified font and persists removal across restart", async () => {
    const unverified = {
      ...stored("unverified"),
      fontFamily: "Cooper Hewitt",
      license: { fileName: "readme.txt" },
    };
    const contentPath = path.join(dataRoot, "assets", unverified.storageKey);
    await mkdir(path.dirname(contentPath), { recursive: true });
    await writeFile(contentPath, "font bytes");
    await writeFile(
      path.join(dataRoot, "assets.json"),
      JSON.stringify([unverified]),
    );

    const result = await store.enforceFontGovernance(new Set());
    expect(result.deleted).toEqual([unverified.id]);
    await expect(access(contentPath)).rejects.toThrow();
    expect(await new FileSystemAssetStore(dataRoot).list()).toEqual([]);
  });

  it("retires and retains a referenced historical face and its bytes", async () => {
    const historical = {
      ...stored("historical"),
      fontFamily: "Walrus",
      license: { fileName: "PLEASE-READ.txt" },
    };
    const contentPath = path.join(dataRoot, "assets", historical.storageKey);
    await mkdir(path.dirname(contentPath), { recursive: true });
    await writeFile(contentPath, "historical font bytes");
    await writeFile(
      path.join(dataRoot, "assets.json"),
      JSON.stringify([historical]),
    );

    const result = await store.enforceFontGovernance(new Set([historical.id]));
    expect(result.retired).toEqual([historical.id]);
    expect((await store.list())[0]?.fontGovernanceStatus).toBe("retired");
    await expect(access(contentPath)).resolves.toBeUndefined();
    expect(await store.remove(historical.id, new Set([historical.id]))).toBe(
      "retained",
    );
  });

  it("records an explicit organization license attestation before approving a family", async () => {
    const unverified = {
      ...stored("licensed-avenir"),
      fontFamily: "Avenir Next LT Pro",
      fontGovernanceStatus: "unverified" as const,
    };
    await writeFile(
      path.join(dataRoot, "assets.json"),
      JSON.stringify([unverified]),
    );

    const approved = await store.approveFontFamilies(
      new Set(["Avenir Next LT Pro"]),
      {
        type: "Organization-owned commercial license",
        attestedAt: "2026-09-01T00:00:00.000Z",
        attestedBy: "organization owner",
        usageScope: "internal use only",
      },
    );

    expect(approved).toHaveLength(1);
    expect((await store.list())[0]).toMatchObject({
      fontGovernanceStatus: "approved",
      license: {
        type: "Organization-owned commercial license",
        attestedAt: "2026-09-01T00:00:00.000Z",
        attestedBy: "organization owner",
        usageScope: "internal use only",
      },
    });
  });
});
