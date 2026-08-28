import { afterEach, describe, expect, it, vi } from "vitest";
import { runExportPreflight } from "./exportPreflight";
import type {
  Asset,
  ImageElement,
  ReportElement,
  ReportTemplate,
} from "../../types/report";

const managedNunito: Asset = {
  id: "nunito-regular",
  name: "Nunito Sans Regular",
  type: "font",
  mimeType: "font/ttf",
  source: "/api/assets/nunito-regular/content",
  createdAt: "2026-08-27T00:00:00.000Z",
  fontFamily: "Nunito Sans",
  fontWeight: 400,
  fontStyle: "normal",
  checksum: "expected-checksum",
  fontGovernanceStatus: "approved",
  version: 1,
};

const imageElement = (overrides: Partial<ImageElement> = {}): ImageElement => ({
  id: "img-1",
  type: "image",
  name: "Contributor photo",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  style: {},
  src: "00PVy00000AbCdEfGh",
  ...overrides,
});

const templateWith = (
  element: ReportElement,
  assets?: Asset[],
): ReportTemplate => ({
  id: "t",
  name: "Test template",
  version: "1",
  pages: [
    {
      id: "p1",
      name: "Page 1",
      width: 800,
      height: 600,
      background: "#fff",
      elements: [element],
    },
  ],
  assets,
});

describe("runExportPreflight image content-type check", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails preflight with a specific message when an image src resolves to text/html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    const issues = await runExportPreflight(
      templateWith(imageElement({ src: "00PVy00000AbCdEfGh" })),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "error", kind: "image" });
    expect(issues[0].message).toBe(
      "Image preflight failed: Contributor photo resolved to text/html instead of an image.",
    );
  });

  it("also fails preflight for any other non-image content type, not just text/html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("%PDF-1.4", {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
      ),
    );
    const issues = await runExportPreflight(
      templateWith(imageElement({ src: "/some/misconfigured/asset" })),
    );
    expect(issues[0].message).toContain(
      "resolved to application/pdf instead of an image.",
    );
  });

  it("blocks an unavailable managed Nunito Sans face instead of accepting fallback", async () => {
    vi.stubGlobal("document", {
      fonts: { check: vi.fn(() => true) },
    });
    const issues = await runExportPreflight(
      templateWith({
        id: "text-1",
        type: "text",
        name: "Headline",
        x: 0,
        y: 0,
        width: 200,
        height: 30,
        text: "Managed font",
        style: {
          typography: {
            fontFamily: "Nunito Sans",
            fontWeight: 400,
            fontStyle: "normal",
            fontSize: 16,
            color: "#000",
            letterSpacing: 0,
            lineHeight: 1.2,
            textAlign: "left",
            verticalAlign: "top",
            italic: false,
            underline: false,
          },
        },
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        level: "error",
        kind: "font",
        message: expect.stringContaining("face is unavailable"),
      }),
    ]);
  });

  it("accepts a dynamically generated placeholder pinned to the loaded managed face", async () => {
    const check = vi.fn(() => true);
    vi.stubGlobal("document", { fonts: { check } });
    const issues = await runExportPreflight(
      templateWith(
        {
          id: "unavailable",
          type: "text",
          name: "Data unavailable",
          x: 0,
          y: 0,
          width: 200,
          height: 30,
          text: "Content not available for this edition",
          style: {
            typography: {
              fontFamily: "Nunito Sans",
              fontWeight: 400,
              fontStyle: "normal",
              fontAssetId: managedNunito.id,
              fontChecksum: managedNunito.checksum,
              fontSize: 11,
              color: "#000",
              letterSpacing: 0,
              lineHeight: 1.2,
              textAlign: "center",
              verticalAlign: "middle",
              italic: false,
              underline: false,
            },
          },
        },
        [managedNunito],
      ),
    );
    expect(issues.filter((issue) => issue.kind === "font")).toEqual([]);
    expect(check).toHaveBeenCalledWith(
      expect.stringContaining("LEE Managed nunito-regular"),
      "LEE managed font verification",
    );
  });

  it("still blocks a checksum-changed managed face", async () => {
    vi.stubGlobal("document", {
      fonts: { check: vi.fn(() => true) },
    });
    const issues = await runExportPreflight(
      templateWith(
        {
          id: "changed-font",
          type: "text",
          name: "Data unavailable",
          x: 0,
          y: 0,
          width: 200,
          height: 30,
          text: "Content not available for this edition",
          style: {
            typography: {
              fontFamily: "Nunito Sans",
              fontWeight: 400,
              fontStyle: "normal",
              fontAssetId: managedNunito.id,
              fontChecksum: "stale-checksum",
              fontSize: 11,
              color: "#000",
              letterSpacing: 0,
              lineHeight: 1.2,
              textAlign: "center",
              verticalAlign: "middle",
              italic: false,
              underline: false,
            },
          },
        },
        [managedNunito],
      ),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        level: "error",
        kind: "font",
        message: expect.stringContaining("missing or changed managed font"),
      }),
    ]);
  });

  it("blocks a new publication using a retired face but permits immutable historical reproduction", async () => {
    vi.stubGlobal("document", { fonts: { check: vi.fn(() => true) } });
    const retired = {
      ...managedNunito,
      id: "retired-face",
      fontFamily: "Walrus",
      fontGovernanceStatus: "retired" as const,
    };
    const element = {
      id: "historical-title",
      type: "text" as const,
      name: "Historical title",
      x: 0,
      y: 0,
      width: 200,
      height: 30,
      text: "Historical",
      style: {
        fontFamily: "Walrus",
        fontWeight: 400,
        fontStyle: "normal" as const,
        fontAssetId: retired.id,
        fontChecksum: retired.checksum,
      },
    };
    const template = templateWith(element, [retired]);
    expect(await runExportPreflight(template)).toEqual([
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("non-approved managed font Walrus"),
      }),
    ]);
    expect(await runExportPreflight(template, { historical: true })).toEqual(
      [],
    );
  });
});
