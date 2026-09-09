import { describe, expect, it, vi } from "vitest";
import type { ImageElement, ReportTemplate } from "../../src/types/report";
import { runServerPublicationImagePreflight } from "./publicationPreflight";

const template = (image: Partial<ImageElement>): ReportTemplate => ({
  id: "report",
  name: "Report",
  version: "1",
  pages: [
    {
      id: "page",
      name: "Page",
      width: 100,
      height: 100,
      background: "#fff",
      elements: [
        {
          id: "image",
          type: "image",
          name: "Hero",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          style: {},
          src: "",
          ...image,
        },
      ],
    },
  ],
});

describe("server publication image preflight", () => {
  it("blocks direct final rendering when required src is missing", async () => {
    const issues = await runServerPublicationImagePreflight(
      template({ src: "" }),
      {
        baseUrl: "http://127.0.0.1:3000",
      },
    );
    expect(issues[0]).toMatchObject({ code: "MISSING_REQUIRED_IMAGE" });
  });

  it("blocks failed and non-image content loads", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("not found", {
          status: 404,
          headers: { "content-type": "text/html" },
        }),
    );
    const issues = await runServerPublicationImagePreflight(
      template({ src: "/missing.png" }),
      { baseUrl: "http://127.0.0.1:3000", fetch: fetcher },
    );
    expect(issues[0]).toMatchObject({ code: "UNRESOLVED_IMAGE_ASSET" });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3000/missing.png"),
      { method: "HEAD" },
    );
  });

  it("checks repeated large images without requesting response bodies", async () => {
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.method).toBe("HEAD");
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(2 * 1024 * 1024),
        },
      });
    });
    const repeated = template({ src: "/large.jpg" });
    repeated.pages[0]!.elements = Array.from({ length: 44 }, (_, index) => ({
      ...(repeated.pages[0]!.elements[0] as ImageElement),
      id: `image-${index}`,
      name: `Image ${index}`,
      src: `/large-${index}.jpg`,
    }));

    await expect(
      runServerPublicationImagePreflight(repeated, {
        baseUrl: "http://127.0.0.1:3000",
        fetch: fetcher as typeof fetch,
      }),
    ).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(44);
  });

  it("accepts valid, hidden, optional, and repeated-page image cases", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("png", {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );
    await expect(
      runServerPublicationImagePreflight(template({ src: "/valid.png" }), {
        baseUrl: "http://127.0.0.1:3000/base/",
        fetch: fetcher,
      }),
    ).resolves.toEqual([]);
    await expect(
      runServerPublicationImagePreflight(template({ src: "", hidden: true }), {
        baseUrl: "http://127.0.0.1:3000",
        fetch: fetcher,
      }),
    ).resolves.toEqual([]);
    await expect(
      runServerPublicationImagePreflight(
        template({ src: "", publicationRequired: false }),
        { baseUrl: "http://127.0.0.1:3000", fetch: fetcher },
      ),
    ).resolves.toEqual([]);
  });
});
