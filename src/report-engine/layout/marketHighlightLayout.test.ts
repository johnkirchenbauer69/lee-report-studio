import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../../data/sampleTemplate";
import { applyMarketHighlightLayout } from "./marketHighlightLayout";
import type { ReportPage } from "../../types/report";

const highlightsPage = sampleTemplate.pages.find(
  (page) => page.id === "market-highlights",
)!;

function record(index: number, kind: "record" | "none" = "record") {
  return {
    address: `${100 + index} Test St`,
    image: kind === "record" ? `/img-${index}.jpg` : "",
    detail: kind === "record" ? "100,000 SF - Test" : "",
    state: kind,
  };
}

function items(count: number) {
  return Array.from({ length: 3 }, (_, index) =>
    index < count ? record(index) : record(index, "none"),
  );
}

function dataFor(
  counts: { availabilities: number; deliveries: number; construction: number },
  period = "2026 Q3",
) {
  return {
    report: { period },
    topAvailabilities: items(counts.availabilities),
    topDeliveries: items(counts.deliveries),
    topConstruction: items(counts.construction),
  };
}

function textOf(page: ReportPage) {
  return page.elements
    .filter((el) => el.type === "text")
    .map((el) => el.text);
}

function imagesOf(page: ReportPage, prefix: "availability" | "deliveries" | "construction") {
  return page.elements.filter(
    (el) => el.type === "image" && el.id.startsWith(`${prefix}-image-`),
  );
}

describe("applyMarketHighlightLayout", () => {
  it("leaves an unrelated page (e.g. Market Overview) completely untouched", () => {
    const overviewPage = sampleTemplate.pages.find(
      (page) => page.id === "market-overview",
    )!;
    const [result] = applyMarketHighlightLayout(
      [overviewPage],
      dataFor({ availabilities: 3, deliveries: 3, construction: 3 }),
    );
    expect(result).toEqual(overviewPage);
  });

  it("never renders the phrase 'None to Report' for any populated-count combination", () => {
    const combinations = [
      { availabilities: 3, deliveries: 3, construction: 3 },
      { availabilities: 3, deliveries: 0, construction: 3 },
      { availabilities: 3, deliveries: 0, construction: 2 },
      { availabilities: 3, deliveries: 0, construction: 0 },
      { availabilities: 0, deliveries: 0, construction: 0 },
      { availabilities: 1, deliveries: 2, construction: 3 },
    ];
    for (const combo of combinations) {
      const [result] = applyMarketHighlightLayout(
        [highlightsPage],
        dataFor(combo),
      );
      expect(textOf(result).join(" ")).not.toContain("None to Report");
    }
  });

  it("renders exactly 3 cards per section when fully populated (3/3/3)", () => {
    const [result] = applyMarketHighlightLayout(
      [highlightsPage],
      dataFor({ availabilities: 3, deliveries: 3, construction: 3 }),
    );
    expect(imagesOf(result, "availability")).toHaveLength(3);
    expect(imagesOf(result, "deliveries")).toHaveLength(3);
    expect(imagesOf(result, "construction")).toHaveLength(3);
    // Nothing was empty, so no empty-state elements should appear.
    expect(
      result.elements.filter((el) => el.id.includes("empty-state")),
    ).toHaveLength(0);
  });

  it("renders exactly 2 equal-width cards, not 3, for a 2-record section", () => {
    const [result] = applyMarketHighlightLayout(
      [highlightsPage],
      dataFor({ availabilities: 3, deliveries: 2, construction: 3 }),
    );
    const deliveryImages = imagesOf(result, "deliveries");
    expect(deliveryImages).toHaveLength(2);
    const widths = deliveryImages.map((el) => el.width).sort((a, b) => a - b);
    expect(Math.abs(widths[0]! - widths[1]!)).toBeLessThanOrEqual(1);
  });

  it("renders exactly 1 wider card, not 3, for a 1-record section", () => {
    const [result] = applyMarketHighlightLayout(
      [highlightsPage],
      dataFor({ availabilities: 1, deliveries: 3, construction: 3 }),
    );
    const availabilityImages = imagesOf(result, "availability");
    expect(availabilityImages).toHaveLength(1);
    const baselineCardWidth = imagesOf(highlightsPage, "availability")[0]!.width;
    expect(availabilityImages[0]!.width).toBeGreaterThan(baselineCardWidth);
  });

  it("renders zero property cards and a category-specific compact empty state for a 0-record section", () => {
    const [result] = applyMarketHighlightLayout(
      [highlightsPage],
      dataFor({ availabilities: 3, deliveries: 0, construction: 3 }),
    );
    expect(imagesOf(result, "deliveries")).toHaveLength(0);
    const emptyStateText = result.elements.find(
      (el) => el.id === "deliveries-empty-state-text",
    );
    expect(emptyStateText).toBeDefined();
    expect((emptyStateText as { text: string }).text).toBe("No Q3 Deliveries");
  });

  it("uses category-specific empty-state wording for each section", () => {
    const [result] = applyMarketHighlightLayout(
      [highlightsPage],
      dataFor({ availabilities: 0, deliveries: 0, construction: 0 }),
    );
    const labelFor = (id: string) =>
      (
        result.elements.find((el) => el.id === id) as { text: string } | undefined
      )?.text;
    expect(labelFor("availability-empty-state-text")).toBe(
      "No Qualifying Availabilities",
    );
    expect(labelFor("deliveries-empty-state-text")).toBe("No Q3 Deliveries");
    expect(labelFor("construction-empty-state-text")).toBe(
      "No Projects Under Construction",
    );
  });

  it("derives the deliveries empty-state label from the report's actual quarter, not a hardcoded Q3", () => {
    const labelFor = (period: string) => {
      const [result] = applyMarketHighlightLayout(
        [highlightsPage],
        dataFor({ availabilities: 3, deliveries: 0, construction: 3 }, period),
      );
      return (
        result.elements.find(
          (el) => el.id === "deliveries-empty-state-text",
        ) as { text: string } | undefined
      )?.text;
    };
    expect(labelFor("2026 Q1")).toBe("No Q1 Deliveries");
    expect(labelFor("2026 Q2")).toBe("No Q2 Deliveries");
    expect(labelFor("2027 Q4")).toBe("No Q4 Deliveries");
  });

  it("never produces a 3x3 grid when every section is empty, and stays within the original printable bounds", () => {
    const [result] = applyMarketHighlightLayout(
      [highlightsPage],
      dataFor({ availabilities: 0, deliveries: 0, construction: 0 }),
    );
    expect(imagesOf(result, "availability")).toHaveLength(0);
    expect(imagesOf(result, "deliveries")).toHaveLength(0);
    expect(imagesOf(result, "construction")).toHaveLength(0);
    for (const element of result.elements) {
      expect(element.y + element.height).toBeLessThanOrEqual(result.height);
      expect(element.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("redistributes reclaimed height to populated sections without exceeding the original bottom bound or a single oversized row", () => {
    const baselineBottom = Math.max(
      ...imagesOf(highlightsPage, "construction").map((el) => el.y + el.height),
      ...highlightsPage.elements
        .filter((el) => el.id === "construction-caption-0")
        .map((el) => el.y + el.height),
    );
    const [result] = applyMarketHighlightLayout(
      [highlightsPage],
      dataFor({ availabilities: 3, deliveries: 0, construction: 3 }),
    );
    const bottoms = [
      ...imagesOf(result, "availability"),
      ...imagesOf(result, "construction"),
    ].map((el) => el.y + el.height);
    for (const bottom of bottoms) expect(bottom).toBeLessThanOrEqual(baselineBottom);
    const baselineImageHeight = imagesOf(highlightsPage, "availability")[0]!.height;
    for (const image of [
      ...imagesOf(result, "availability"),
      ...imagesOf(result, "construction"),
    ]) {
      // Modest growth only -- never a visually oversized single row.
      expect(image.height).toBeLessThanOrEqual(baselineImageHeight + 48);
    }
  });

  it("keeps the 3/3/3 layout materially unchanged (baseline geometry preserved)", () => {
    const [result] = applyMarketHighlightLayout(
      [highlightsPage],
      dataFor({ availabilities: 3, deliveries: 3, construction: 3 }),
    );
    const before = imagesOf(highlightsPage, "availability")[0]!;
    const after = imagesOf(result, "availability")[0]!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it("always renders the beveled bar and title after (on top of) every card image, for every populated-count combination", () => {
    const combinations = [
      { availabilities: 3, deliveries: 3, construction: 3 },
      { availabilities: 2, deliveries: 1, construction: 3 },
      { availabilities: 3, deliveries: 0, construction: 3 },
      { availabilities: 0, deliveries: 0, construction: 0 },
    ];
    for (const combo of combinations) {
      const [result] = applyMarketHighlightLayout([highlightsPage], dataFor(combo));
      for (const prefix of ["availability", "deliveries", "construction"] as const) {
        const barIndex = result.elements.findIndex((e) => e.id === `${prefix}-bar`);
        const titleIndex = result.elements.findIndex(
          (e) => e.id === `${prefix}-section-title`,
        );
        expect(barIndex).toBeGreaterThan(-1);
        expect(titleIndex).toBeGreaterThan(-1);
        const cardIndices = result.elements
          .map((e, index) => ({ id: e.id, index }))
          .filter(({ id }) => id.startsWith(`${prefix}-image-`))
          .map(({ index }) => index);
        for (const cardIndex of cardIndices) {
          expect(barIndex).toBeGreaterThan(cardIndex);
          expect(titleIndex).toBeGreaterThan(cardIndex);
        }
        // Empty-state elements (when present) must also sit behind the bar.
        const emptyStateIndices = result.elements
          .map((e, index) => ({ id: e.id, index }))
          .filter(({ id }) => id === `${prefix}-empty-state-bg` || id === `${prefix}-empty-state-text`)
          .map(({ index }) => index);
        for (const emptyIndex of emptyStateIndices) {
          expect(barIndex).toBeGreaterThan(emptyIndex);
        }
      }
    }
  });
});
