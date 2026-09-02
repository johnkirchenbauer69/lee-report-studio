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
  fontGovernanceStatus: "approved",
};
const semibold: Asset = {
  ...regular,
  id: "nunito-semibold",
  name: "Nunito Sans Semibold",
  fontWeight: 600,
  checksum: "semibold-checksum",
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

  it("pins marketing chart SVG text to the exact managed semibold face", () => {
    const migrated = normalizeReportTemplateFonts(sampleTemplate, [
      regular,
      semibold,
    ]);
    const chart = migrated.pages
      .flatMap((page) => page.elements)
      .find((element) => element.type === "chart" && element.marketingChartId);
    expect(
      chart?.type === "chart" ? chart.chartStyle : undefined,
    ).toMatchObject({
      fontFamily: "Nunito Sans",
      fontWeight: 600,
      fontStyle: "normal",
      fontAssetId: semibold.id,
      fontChecksum: semibold.checksum,
    });
  });

  it("preserves a stale checksum pin so strict preflight can reject it", () => {
    const source = structuredClone(sampleTemplate);
    const text = source.pages
      .flatMap((page) => page.elements)
      .find((element) => element.type === "text")!;
    text.style = {
      ...text.style,
      typography: {
        fontFamily: "Nunito Sans",
        fontWeight: 400,
        fontStyle: "normal",
        fontAssetId: regular.id,
        fontChecksum: "stale-checksum",
        fontSize: 16,
        color: "#000",
        letterSpacing: 0,
        lineHeight: 1.2,
        textAlign: "left",
        verticalAlign: "top",
        italic: false,
        underline: false,
      },
    };
    const normalized = normalizeReportTemplateFonts(source, [regular]);
    const result = normalized.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === text.id)!;
    expect(result.style.typography).toMatchObject({
      fontAssetId: regular.id,
      fontChecksum: "stale-checksum",
    });
  });
});
