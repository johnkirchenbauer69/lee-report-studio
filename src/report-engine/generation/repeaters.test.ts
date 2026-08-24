import { describe, expect, it } from "vitest";
import type { ReportTemplate } from "../../types/report";
import { expandTemplatePages } from "./repeaters";
import { sampleTemplate } from "../../data/sampleTemplate";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { buildPresentationModel } from "../bindings/presentationModel";
import { chicagoSubmarketId } from "../submarkets";

const template: ReportTemplate = {
  id: "t",
  name: "T",
  version: "1",
  pages: [
    {
      id: "market",
      name: "{item} Detail",
      width: 816,
      height: 1056,
      background: "#fff",
      repeat: { sourcePath: "submarkets", contextName: "market" },
      elements: [
        {
          id: "title",
          type: "text",
          name: "Title",
          x: 0,
          y: 0,
          width: 100,
          height: 20,
          text: "",
          binding: { path: "market.name" },
          style: {},
        },
        {
          id: "lease",
          type: "text",
          name: "Lease",
          x: 0,
          y: 30,
          width: 100,
          height: 20,
          text: "",
          binding: { path: "lease.tenant" },
          repeat: {
            sourcePath: "leasing",
            contextName: "lease",
            direction: "vertical",
            maximumItems: 2,
            spacing: 5,
          },
          style: {},
        },
      ],
    },
  ],
};

describe("report repeaters", () =>
  it("expands pages and components with contextual bindings", () => {
    const pages = expandTemplatePages(template, {
      submarkets: [{ name: "O’Hare" }, { name: "I-55" }],
      leasing: [{ tenant: "A" }, { tenant: "B" }, { tenant: "C" }],
    });
    expect(pages).toHaveLength(2);
    expect(pages[0].name).toBe("O’Hare Detail");
    expect(pages[0].bindingContext).toEqual({
      name: "market",
      path: "submarkets[0]",
    });
    expect(
      pages[0].elements.filter((item) => item.name.startsWith("Lease")),
    ).toHaveLength(2);
    expect(pages[0].elements[1].bindingContext).toEqual({
      name: "lease",
      path: "leasing[0]",
    });
  }));

describe("industrial detail page selection", () => {
  const data = buildPresentationModel(q2SampleReport);

  it("keeps the four Overall Market and four static pages when no details are selected", () => {
    expect(
      expandTemplatePages(sampleTemplate, data, { submarkets: [] }).map(
        (page) => page.name,
      ),
    ).toEqual([
      "Cover",
      "Overall Market Table",
      "Market Overview",
      "Market Highlights",
      "Data Methodology",
      "Definitions",
      "Contacts",
      "Who We Are",
    ]);
  });

  it("appends the selected submarket Overview and Highlights pair with exact context", () => {
    const pages = expandTemplatePages(sampleTemplate, data, {
      submarkets: ["O'Hare"],
    });
    expect(pages).toHaveLength(10);
    expect(pages.slice(4, 6).map((page) => page.name)).toEqual([
      "O'Hare Overview",
      "O'Hare Highlights",
    ]);
    expect(pages[4].bindingContext).toEqual({
      name: "market",
      path: "submarketDetails[13]",
    });
    expect(pages[5].bindingContext).toEqual({
      name: "market",
      path: "submarketDetails[13]",
    });
    expect(pages[4].bindingContext?.path).not.toContain("overallMarket");
  });

  it("creates the final 44 pages for all 18 accepted Chicago submarkets", () => {
    const selected = q2SampleReport.submarkets.map((item) =>
      chicagoSubmarketId(item.name)!,
    );
    const pages = expandTemplatePages(sampleTemplate, data, {
      submarketIds: selected,
    });
    expect(selected).toHaveLength(18);
    expect(pages).toHaveLength(44);
    expect(pages.slice(4, 40).map((page) => page.name)).toEqual(
      q2SampleReport.submarkets.flatMap((item) => {
        const displayName =
          item.name === "I-80 Corridor/Joliet" ? "I-80/Joliet Area" : item.name;
        return [`${displayName} Overview`, `${displayName} Highlights`];
      }),
    );
    expect(pages.map((page) => page.pageNumber)).toEqual(
      Array.from({ length: 44 }, (_, index) => index + 1),
    );
    expect(
      pages[4].elements.find((item) => item.name === "Page Number"),
    ).toMatchObject({
      type: "text",
      text: "5",
    });
    expect(pages.slice(40).map((page) => page.name)).toEqual([
      "Data Methodology",
      "Definitions",
      "Contacts",
      "Who We Are",
    ]);
    expect(pages.slice(40).map((page) => page.pageNumber)).toEqual([
      41, 42, 43, 44,
    ]);
  });

  it("resolves the I-80 display alias through its canonical id without dropping its pair", () => {
    const pages = expandTemplatePages(sampleTemplate, data, {
      submarketIds: ["i80-joliet"],
    });
    expect(pages.slice(4, 6).map((page) => page.name)).toEqual([
      "I-80/Joliet Area Overview",
      "I-80/Joliet Area Highlights",
    ]);
    expect(pages[4].bindingContext?.path).toBe("submarketDetails[5]");
    expect(
      pages[4].elements.find((element) => element.id.includes("market-map")),
    ).toMatchObject({
      type: "image",
      src: "/report-assets/maps/I-80_Corridor_Map.jpg",
    });
  });

  it("preserves the full Southeast Wisconsin name in both generated headers", () => {
    const pages = expandTemplatePages(sampleTemplate, data, {
      submarketIds: ["southeast-wisconsin"],
    });
    expect(pages.slice(4, 6).map((page) => page.name)).toEqual([
      "Southeast Wisconsin Overview",
      "Southeast Wisconsin Highlights",
    ]);
    for (const page of pages.slice(4, 6))
      expect(
        page.elements.find((item) => item.name === "Market"),
      ).toMatchObject({
        width: 330,
        binding: { path: "market.displayName" },
      });
    expect(
      pages[4].elements.find((element) => element.id.includes("market-map")),
    ).toMatchObject({
      type: "image",
      src: "/report-assets/maps/Southeast_Wisconsin_Map.jpg",
    });
  });

  it("rejects unknown or duplicate canonical selections instead of silently dropping them", () => {
    expect(() =>
      expandTemplatePages(sampleTemplate, data, {
        submarketIds: ["missing-submarket"],
      }),
    ).toThrow(/Unknown selected Chicago submarket/);
    expect(() =>
      expandTemplatePages(sampleTemplate, data, {
        submarkets: ["I-80 Corridor\/Joliet", "I-80\/Joliet Area"],
      }),
    ).toThrow(/unique canonical IDs/);
  });
});
