import { afterEach, describe, expect, it, vi } from "vitest";
import { runExportPreflight } from "./exportPreflight";
import type {
  ImageElement,
  ReportElement,
  ReportTemplate,
} from "../../types/report";

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

const templateWith = (element: ReportElement): ReportTemplate => ({
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
});
