import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../../data/sampleTemplate";
import { generateReportInstance } from "../generation/generateReport";
import type { ImageElement } from "../../types/report";
import { normalizeReportInstance, serializeReportInstance } from "./reportInstancePersistence";

async function fixture() {
  return generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
}

const findImage = (
  pages: { elements: { id: string; type: string }[] }[],
  id: string,
) => {
  for (const page of pages) {
    const found = page.elements.find((element) => element.id === id);
    if (found) return found as unknown as ImageElement;
  }
  throw new Error(`Image ${id} not found in fixture.`);
};

describe("image crop persistence (single canonical x/y/zoom representation)", () => {
  it("keeps an image whose crop is entirely absent valid (backward compatible)", async () => {
    const instance = await fixture();
    const stripped = structuredClone(instance) as unknown as {
      pages: { elements: Record<string, unknown>[] }[];
    };
    const image = stripped.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === "cover-photo")!;
    delete image.crop;
    expect(() => normalizeReportInstance(stripped)).not.toThrow();
    const normalized = normalizeReportInstance(stripped);
    expect(findImage(normalized.pages, "cover-photo").crop).toBeUndefined();
  });

  it("round-trips a manually-edited crop (pan + zoom) exactly, with no extra fields", async () => {
    const instance = await fixture();
    const styled = structuredClone(instance);
    const page = styled.pages.find((candidate) =>
      candidate.elements.some((element) => element.id === "cover-photo"),
    )!;
    const image = page.elements.find(
      (element) => element.id === "cover-photo",
    ) as unknown as ImageElement;
    image.crop = { x: 62.5, y: 18.25, zoom: 2.4 };

    const serialized = serializeReportInstance(styled);
    const parsed = JSON.parse(serialized);
    const restoredImage = findImage(
      (parsed as { pages: { elements: { id: string; type: string }[] }[] }).pages,
      "cover-photo",
    );
    // Only x/y/zoom -- no second, parallel crop-rect representation.
    expect(Object.keys(restoredImage.crop ?? {}).sort()).toEqual([
      "x",
      "y",
      "zoom",
    ]);

    const restored = normalizeReportInstance(parsed);
    const restoredNormalized = findImage(restored.pages, "cover-photo");
    expect(restoredNormalized.crop).toEqual({ x: 62.5, y: 18.25, zoom: 2.4 });
  });

  it("rejects a crop with an unknown field (strict schema, single canonical shape)", async () => {
    const instance = await fixture();
    const tampered = structuredClone(instance) as unknown as {
      pages: { elements: Record<string, unknown>[] }[];
    };
    const image = tampered.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === "cover-photo")!;
    image.crop = { x: 50, y: 50, zoom: 1, left: 10 };
    expect(() => normalizeReportInstance(tampered)).toThrow();
  });

  it("rejects a non-positive zoom", async () => {
    const instance = await fixture();
    const tampered = structuredClone(instance) as unknown as {
      pages: { elements: Record<string, unknown>[] }[];
    };
    const image = tampered.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === "cover-photo")!;
    image.crop = { x: 50, y: 50, zoom: 0 };
    expect(() => normalizeReportInstance(tampered)).toThrow();
  });
});
