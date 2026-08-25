import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../data/sampleTemplate";
import type { Asset } from "../types/report";
import { normalizeReportTemplateFonts } from "./templateNormalization";

const regular: Asset = {
  id: "nunito-regular",
  name: "Nunito Sans Regular",
  type: "font",
  mimeType: "font/ttf",
  source: "/api/assets/nunito-regular/content",
  createdAt: "2026-08-25T00:00:00.000Z",
  fontFamily: "Nunito Sans",
  fontWeight: 400,
  fontStyle: "normal",
  checksum: "regular-checksum",
};

describe("template typography migration", () => {
  it("normalizes editable legacy stacks and checksum-pins available managed faces", () => {
    const source = structuredClone(sampleTemplate);
    const text = source.pages
      .flatMap((page) => page.elements)
      .find(
        (element) =>
          element.type === "text" &&
          element.style.fontFamily?.includes("Nunito Sans"),
      )!;
    text.style.fontFamily = '"Nunito Sans", Arial, sans-serif';
    text.style.fontWeight = 400;
    const migrated = normalizeReportTemplateFonts(source, [regular]);
    const result = migrated.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === text.id)!;
    expect(result.style.typography).toMatchObject({
      fontFamily: "Nunito Sans",
      fontWeight: 400,
      fontStyle: "normal",
      fontAssetId: regular.id,
      fontChecksum: regular.checksum,
    });
  });

  it("does not rewrite raster image content", () => {
    const image = sampleTemplate.pages
      .flatMap((page) => page.elements)
      .find((element) => element.type === "image")!;
    const migrated = normalizeReportTemplateFonts(sampleTemplate, [regular]);
    expect(
      migrated.pages
        .flatMap((page) => page.elements)
        .find((item) => item.id === image.id),
    ).toEqual(image);
  });
});
