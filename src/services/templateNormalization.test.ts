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
const black: Asset = {
  ...regular,
  id: "nunito-black",
  name: "Nunito Sans Black",
  fontWeight: 900,
  checksum: "black-checksum",
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

  it("pins transaction chips to the exact managed Nunito Sans 900 face", () => {
    const migrated = normalizeReportTemplateFonts(sampleTemplate, [black]);
    const tables = migrated.pages
      .flatMap((page) => page.elements)
      .filter(
        (element) =>
          element.type === "table" && element.variant === "transactions",
      );

    expect(tables).toHaveLength(4);
    for (const table of tables)
      expect(
        table.type === "table" && table.transactionChipStyle,
      ).toMatchObject({
        fontFamily: "Nunito Sans",
        fontWeight: 900,
        fontStyle: "normal",
        fontAssetId: black.id,
        fontChecksum: black.checksum,
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

  it("preserves structured bevel, corner, image-shadow, and table cell-shadow styles", () => {
    const source = structuredClone(sampleTemplate);
    const shape = source.pages[0].elements.find(
      (element) => element.type === "shape",
    )!;
    shape.style.bevel = {
      enabled: true,
      size: 4,
      direction: "raised",
      highlightColor: "#ffffff",
      highlightOpacity: 0.5,
      shadowColor: "#000000",
      shadowOpacity: 0.3,
    };
    shape.style.cornerRadii = {
      topLeft: 12,
      topRight: 8,
      bottomRight: 4,
      bottomLeft: 0,
      linked: false,
    };
    const image = source.pages[0].elements.find(
      (element) => element.type === "image",
    )!;
    image.style.shadow = {
      enabled: true,
      color: "#123456",
      offsetX: 2,
      offsetY: 3,
      blur: 6,
      opacity: 0.4,
    };
    const table = source.pages
      .flatMap((page) => page.elements)
      .find((element) => element.type === "table");
    if (!table || table.type !== "table")
      throw new Error("Fixture table missing");
    table.columns[0].headerStyle = {
      ...table.columns[0].headerStyle,
      shadow: {
        enabled: true,
        color: "#000000",
        offsetX: 1,
        offsetY: 1,
        blur: 2,
        opacity: 0.25,
      },
    };
    table.cellStyles = {
      ...table.cellStyles,
      "body:0:0": {
        shadow: {
          enabled: true,
          color: "#000000",
          offsetX: 1,
          offsetY: 2,
          blur: 3,
          opacity: 0.5,
        },
      },
    };

    const normalized = normalizeReportTemplateFonts(source, []);
    expect(
      normalized.pages[0].elements.find((element) => element.id === shape.id)
        ?.style,
    ).toMatchObject({
      bevel: shape.style.bevel,
      cornerRadii: shape.style.cornerRadii,
    });
    expect(
      normalized.pages[0].elements.find((element) => element.id === image.id)
        ?.style.shadow,
    ).toEqual(image.style.shadow);
    const normalizedTable = normalized.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === table.id);
    expect(
      normalizedTable?.type === "table" &&
        normalizedTable.columns[0].headerStyle?.shadow,
    ).toEqual(table.columns[0].headerStyle?.shadow);
    expect(
      normalizedTable?.type === "table" &&
        normalizedTable.cellStyles?.["body:0:0"]?.shadow,
    ).toEqual(table.cellStyles["body:0:0"].shadow);
  });

  it("carries targeted table shadows into a generated report instance", async () => {
    const { generateReportInstance } =
      await import("../report-engine/generation/generateReport");
    const source = structuredClone(sampleTemplate);
    const table = source.pages
      .flatMap((page) => page.elements)
      .find((element) => element.type === "table");
    if (!table || table.type !== "table")
      throw new Error("Fixture table missing");
    table.columns[0].bodyStyle = {
      ...table.columns[0].bodyStyle,
      shadow: {
        enabled: true,
        color: "#000000",
        offsetX: 1,
        offsetY: 1,
        blur: 2,
        opacity: 0.25,
      },
    };
    const instance = await generateReportInstance(source, {
      templateId: source.id,
      templateVersion: source.version,
      market: "Chicago",
      period: "2026 Q2",
      calculationScope: { type: "all-submarkets" },
      pageSelection: { submarkets: [] },
      source: { provider: "sample" },
    });
    const generated = instance.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === table.id);
    expect(
      generated?.type === "table" && generated.columns[0].bodyStyle?.shadow,
    ).toEqual(table.columns[0].bodyStyle?.shadow);
  });
});
