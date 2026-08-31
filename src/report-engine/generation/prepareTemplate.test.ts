import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { sampleTemplate } from "../../data/sampleTemplate";
import type { Asset, TextElement } from "../../types/report";
import { buildPresentationModel } from "../bindings/presentationModel";
import {
  prepareTemplateForPublication,
  prepareTemplateForReport,
} from "./prepareTemplate";

const managedNunito600: Asset = {
  id: "nunito-sans-semibold",
  name: "Nunito Sans SemiBold",
  type: "font",
  mimeType: "font/ttf",
  source: "/api/assets/nunito-sans-semibold/content",
  createdAt: "2026-08-27T00:00:00.000Z",
  fontFamily: "Nunito Sans",
  fontWeight: 600,
  fontStyle: "normal",
  checksum: "nunito-sans-semibold-checksum",
  fontGovernanceStatus: "approved",
  version: 1,
};

describe("production template preparation", () => {
  it("keeps the bound native historical chart and managed Overall Market map", () => {
    const prepared = prepareTemplateForReport(
      sampleTemplate,
      q2SampleReport,
      buildPresentationModel(q2SampleReport),
      "ascendix",
    );
    const overview = prepared.pages.find(
      (page) => page.id === "market-overview",
    )!;
    expect(
      overview.elements.find((element) => element.id === "chart-net")?.type,
    ).toBe("chart");
    expect(
      overview.elements.find((element) => element.id === "market-map"),
    ).toMatchObject({
      type: "image",
      src: "/report-assets/maps/Overall_Market_Map.jpg",
      fit: "contain",
      binding: { path: "overallMarketMapAssetUrl" },
    });
  });

  it("retains the managed static page artwork for every provider", () => {
    const prepared = prepareTemplateForReport(
      sampleTemplate,
      q2SampleReport,
      buildPresentationModel(q2SampleReport),
      "sample",
    );
    expect(
      prepared.pages
        .flatMap((page) => page.elements)
        .some(
          (element) =>
            element.type === "image" &&
            element.src === "/report-assets/static-pages/data-methodology.png",
        ),
    ).toBe(true);
  });

  it("keeps QA diagnostics in the editor but sanitizes all published copy", () => {
    const report = structuredClone(q2SampleReport);
    report.dataCompleteness = report.dataCompleteness.map((item) =>
      item.section === "construction"
        ? { ...item, status: "missing" as const }
        : item,
    );
    const presentation = buildPresentationModel(report);
    const editor = prepareTemplateForReport(
      sampleTemplate,
      report,
      presentation,
      "ascendix",
      "editor",
    );
    const published = prepareTemplateForReport(
      sampleTemplate,
      report,
      presentation,
      "ascendix",
      "published",
    );
    const text = (template: typeof sampleTemplate) =>
      template.pages
        .flatMap((page) => page.elements)
        .flatMap((element) => (element.type === "text" ? [element.text] : []))
        .join("\n");
    expect(text(editor)).toContain("Data unavailable:");
    expect(text(published)).not.toContain("Data unavailable:");
    expect(text(published)).toContain("Content not available for this edition");
    expect(text(published)).toContain("MEDIAN SALES PRICE");
    expect(text(prepareTemplateForPublication(editor))).not.toContain(
      "Data unavailable:",
    );
  });

  it("pins dynamically generated and publication-safe unavailable text to the exact managed face", () => {
    const source = {
      ...structuredClone(sampleTemplate),
      assets: [managedNunito600],
    };
    const report = structuredClone(q2SampleReport);
    report.dataCompleteness = report.dataCompleteness.map((item) =>
      item.section === "construction"
        ? { ...item, status: "missing" as const }
        : item,
    );
    const presentation = buildPresentationModel(report);
    const editor = prepareTemplateForReport(
      source,
      report,
      presentation,
      "ascendix",
      "editor",
    );
    const placeholder = editor.pages
      .flatMap((page) => page.elements)
      .find((element) => element.name === "Data unavailable") as TextElement;
    expect(placeholder).toBeDefined();
    expect(placeholder.style.typography).toMatchObject({
      fontFamily: "Nunito Sans",
      fontWeight: 600,
      fontStyle: "normal",
      fontAssetId: managedNunito600.id,
      fontChecksum: managedNunito600.checksum,
    });

    const published = prepareTemplateForPublication(editor);
    const publishedPlaceholder = published.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === placeholder.id) as TextElement;
    expect(publishedPlaceholder.text).toBe(
      "Content not available for this edition",
    );
    expect(publishedPlaceholder.style.typography).toMatchObject({
      fontAssetId: managedNunito600.id,
      fontChecksum: managedNunito600.checksum,
    });
  });

  it("binds the period only on pages 41-43 and leaves page 44 static", () => {
    const report = structuredClone(q2SampleReport);
    report.report.period = "2027 Q1";
    const prepared = prepareTemplateForReport(
      sampleTemplate,
      report,
      buildPresentationModel(report),
      "sample",
    );
    for (const id of ["data-methodology", "definitions", "contacts"])
      expect(
        prepared.pages
          .find((page) => page.id === id)
          ?.elements.find((element) => element.name === "Quarter"),
      ).toMatchObject({ type: "text", text: "Q1 2027" });
    expect(
      prepared.pages
        .find((page) => page.id === "who-we-are")
        ?.elements.some((element) => element.binding),
    ).toBe(false);
  });
});
