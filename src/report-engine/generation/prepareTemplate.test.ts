import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { sampleTemplate } from "../../data/sampleTemplate";
import { buildPresentationModel } from "../bindings/presentationModel";
import {
  prepareTemplateForPublication,
  prepareTemplateForReport,
} from "./prepareTemplate";

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
    const presentation = buildPresentationModel(q2SampleReport);
    const editor = prepareTemplateForReport(
      sampleTemplate,
      q2SampleReport,
      presentation,
      "ascendix",
      "editor",
    );
    const published = prepareTemplateForReport(
      sampleTemplate,
      q2SampleReport,
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
