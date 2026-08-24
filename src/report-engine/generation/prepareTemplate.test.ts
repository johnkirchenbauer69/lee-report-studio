import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { sampleTemplate } from "../../data/sampleTemplate";
import { buildPresentationModel } from "../bindings/presentationModel";
import {
  prepareTemplateForPublication,
  prepareTemplateForReport,
} from "./prepareTemplate";

describe("production template preparation", () => {
  it("keeps the bound native historical chart and strips the full-page map fixture", () => {
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
      overview.elements.some(
        (element) =>
          element.type === "image" &&
          element.src === "/report-assets/reference-page-3.png",
      ),
    ).toBe(false);
    expect(
      overview.elements.find(
        (element) => element.id === "market-map-data-unavailable",
      ),
    ).toMatchObject({
      type: "text",
      text: "Data unavailable: live submarket map binding is not implemented.",
    });
  });

  it("retains approved reference artwork only for the sample provider", () => {
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
            element.src === "/report-assets/reference-page-3.png",
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
    expect(text(published)).toContain("Submarket map not available");
    expect(text(published)).toContain("MEDIAN SALES PRICE");
    expect(text(prepareTemplateForPublication(editor))).not.toContain(
      "Data unavailable:",
    );
  });
});
