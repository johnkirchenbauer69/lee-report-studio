import { describe, expect, it, vi } from "vitest";
import {
  isSalesforceAttachmentOrFileId,
  resolveSalesforceImage,
} from "./salesforceImageResolver";
import type { SalesforceClient } from "./SalesforceClient";
import type { FileSystemAssetStore } from "../../assets/assetStore";
import type { SalesforceImageIndex } from "../../assets/salesforceImageIndex";

const ATTACHMENT_ID = "00PVy00000AbCdEfGh";
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const fakeIndex = () => {
  const map = new Map<string, string>();
  return {
    get: vi.fn(async (id: string) => map.get(id)),
    set: vi.fn(async (id: string, assetId: string) => {
      map.set(id, assetId);
    }),
  } as unknown as SalesforceImageIndex;
};

const fakeAssetStore = () => ({
  importBuffer: vi.fn(async (input: { buffer: Buffer; mimeType: string }) => ({
    id: "asset-1",
    name: "salesforce-image",
    type: "image" as const,
    mimeType: input.mimeType,
    source: "/api/assets/asset-1/content",
    createdAt: new Date().toISOString(),
    checksum: "checksum",
    storage: "backend" as const,
    storageKey: "images/checksum.jpg",
    size: input.buffer.length,
  })),
});

describe("isSalesforceAttachmentOrFileId", () => {
  it("recognizes an Attachment id (00P prefix)", () => {
    expect(isSalesforceAttachmentOrFileId(ATTACHMENT_ID)).toBe(true);
  });
  it("rejects a normal URL", () => {
    expect(isSalesforceAttachmentOrFileId("https://example.com/a.jpg")).toBe(
      false,
    );
  });
  it("rejects a relative asset URL", () => {
    expect(isSalesforceAttachmentOrFileId("/api/assets/x/content")).toBe(
      false,
    );
  });
});

describe("resolveSalesforceImage", () => {
  it("resolves a mocked Salesforce Attachment binary into a stored JPEG asset", async () => {
    const client: SalesforceClient = {
      query: vi.fn(),
      health: vi.fn(),
      getBinary: vi.fn(async () => ({
        buffer: JPEG_BYTES,
        contentType: "image/jpeg",
        status: 200,
      })),
    };
    const assetStore = fakeAssetStore();
    const index = fakeIndex();

    const result = await resolveSalesforceImage(ATTACHMENT_ID, {
      client,
      assetStore: assetStore as unknown as Pick<
        FileSystemAssetStore,
        "importBuffer"
      >,
      index,
    });

    expect(result.url).toBe("/api/assets/asset-1/content");
    expect(result.warning).toBeUndefined();
    expect(client.getBinary).toHaveBeenCalledWith(
      `sobjects/Attachment/${ATTACHMENT_ID}/Body`,
    );
    expect(assetStore.importBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/jpeg" }),
    );
    expect(index.set).toHaveBeenCalledWith(ATTACHMENT_ID, "asset-1");
  });

  it("rejects an HTML response masquerading as an image (the SPA-fallback bug case) with a warning, never a bare id/URL", async () => {
    const client: SalesforceClient = {
      query: vi.fn(),
      health: vi.fn(),
      getBinary: vi.fn(async () => ({
        buffer: Buffer.from("<!doctype html>"),
        contentType: "text/html",
        status: 200,
      })),
    };
    const assetStore = fakeAssetStore();
    const index = fakeIndex();

    const result = await resolveSalesforceImage(ATTACHMENT_ID, {
      client,
      assetStore: assetStore as unknown as Pick<
        FileSystemAssetStore,
        "importBuffer"
      >,
      index,
    });

    expect(result.url).toBeUndefined();
    expect(result.warning).toMatch(/text\/html instead of an image|received text\/html/);
    expect(assetStore.importBuffer).not.toHaveBeenCalled();
  });

  it("produces a warning, not a silent fallback, for a missing/404 attachment", async () => {
    const client: SalesforceClient = {
      query: vi.fn(),
      health: vi.fn(),
      getBinary: vi.fn(async () => ({
        buffer: Buffer.alloc(0),
        contentType: "",
        status: 404,
      })),
    };
    const assetStore = fakeAssetStore();
    const index = fakeIndex();

    const result = await resolveSalesforceImage(ATTACHMENT_ID, {
      client,
      assetStore: assetStore as unknown as Pick<
        FileSystemAssetStore,
        "importBuffer"
      >,
      index,
    });

    expect(result.url).toBeUndefined();
    expect(result.warning).toBeTruthy();
    expect(assetStore.importBuffer).not.toHaveBeenCalled();
  });

  it("reuses the index cache on a repeated resolve and never re-fetches Salesforce", async () => {
    const client: SalesforceClient = {
      query: vi.fn(),
      health: vi.fn(),
      getBinary: vi.fn(async () => ({
        buffer: JPEG_BYTES,
        contentType: "image/jpeg",
        status: 200,
      })),
    };
    const assetStore = fakeAssetStore();
    const index = fakeIndex();
    const deps = {
      client,
      assetStore: assetStore as unknown as Pick<
        FileSystemAssetStore,
        "importBuffer"
      >,
      index,
    };

    const first = await resolveSalesforceImage(ATTACHMENT_ID, deps);
    const second = await resolveSalesforceImage(ATTACHMENT_ID, deps);

    expect(first.url).toBe(second.url);
    expect(client.getBinary).toHaveBeenCalledTimes(1);
    expect(assetStore.importBuffer).toHaveBeenCalledTimes(1);
  });

  it("passes through a value that is not a recognized Salesforce Attachment/File id unchanged", async () => {
    const client: SalesforceClient = { query: vi.fn(), health: vi.fn() };
    const result = await resolveSalesforceImage("https://example.com/a.jpg", {
      client,
      assetStore: fakeAssetStore() as unknown as Pick<
        FileSystemAssetStore,
        "importBuffer"
      >,
      index: fakeIndex(),
    });
    expect(result.url).toBe("https://example.com/a.jpg");
  });
});
