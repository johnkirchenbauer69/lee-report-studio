import { describe, expect, it } from "vitest";
import type { ReportTemplate } from "../../types/report";
import { expandTemplatePages } from "./repeaters";
import { sampleTemplate } from "../../data/sampleTemplate";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { buildPresentationModel } from "../bindings/presentationModel";

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

  it("keeps the four Overall Market pages when no details are selected", () => {
    expect(
      expandTemplatePages(sampleTemplate, data, { submarkets: [] }).map(
        (page) => page.name,
      ),
    ).toEqual([
      "Cover",
      "Overall Market Table",
      "Market Overview",
      "Market Highlights",
    ]);
  });

  it("appends the selected submarket Overview and Highlights pair with exact context", () => {
    const pages = expandTemplatePages(sampleTemplate, data, {
      submarkets: ["O'Hare"],
    });
    expect(pages).toHaveLength(6);
    expect(pages.slice(4).map((page) => page.name)).toEqual([
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

  it("creates 40 pages for all 18 accepted Chicago submarkets", () => {
    const selected = q2SampleReport.submarkets.map((item) => item.name);
    const pages = expandTemplatePages(sampleTemplate, data, {
      submarkets: selected,
    });
    expect(selected).toHaveLength(18);
    expect(pages).toHaveLength(40);
    expect(pages.slice(4).map((page) => page.name)).toEqual(
      selected.flatMap((name) => [`${name} Overview`, `${name} Highlights`]),
    );
  });
});
