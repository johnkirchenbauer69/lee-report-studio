import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { sampleTemplate } from "../../data/sampleTemplate";
import { buildPresentationModel } from "../bindings/presentationModel";
import { expandTemplatePages } from "../generation/repeaters";
import { resolveChicagoSubmarket } from "../submarkets";
import { resolveOverviewPageTarget, stablePageAnchor } from "./pageNavigation";

const generatedPages = (period: string) => {
  const report = structuredClone(q2SampleReport);
  report.report.period = period;
  return expandTemplatePages(sampleTemplate, buildPresentationModel(report), {
    submarketIds: report.submarkets.map(
      (submarket) => resolveChicagoSubmarket(submarket.name)!.id,
    ),
  });
};

describe("report page navigation", () => {
  it.each(["2026 Q2", "2026 Q3"])(
    "resolves all 18 %s submarkets to exactly one Overview page",
    (period) => {
      const pages = generatedPages(period);
      const targets = q2SampleReport.submarkets.map((submarket) => {
        const identity = resolveChicagoSubmarket(submarket.name)!;
        const matches = pages.filter(
          (page) =>
            page.geographyId === identity.id && page.pageKind === "overview",
        );
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
          anchor: stablePageAnchor(identity.id, "overview"),
          name: expect.stringMatching(/Overview$/),
        });
        expect(matches[0]!.name).not.toMatch(/Highlights/);
        return resolveOverviewPageTarget(pages, identity.id);
      });
      expect(targets.filter(Boolean)).toHaveLength(18);
    },
  );

  it("keeps targets stable when pages are inserted before the submarket section", () => {
    const pages = generatedPages("2026 Q3");
    const target = resolveOverviewPageTarget(pages, "ohare")!;
    const inserted = [
      {
        id: "inserted",
        name: "Inserted page",
        width: 816,
        height: 1056,
        background: "#fff",
        elements: [],
      },
      ...pages,
    ];
    expect(resolveOverviewPageTarget(inserted, "ohare")).toMatchObject({
      id: target.id,
      anchor: "ohare-overview",
    });
  });

  it("provides the Overall Market overview destination", () => {
    expect(
      resolveOverviewPageTarget(generatedPages("2026 Q3"), "overall-market"),
    ).toMatchObject({
      id: "market-overview",
      anchor: "overall-market-overview",
    });
  });
});
