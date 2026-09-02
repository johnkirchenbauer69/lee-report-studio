import { describe, expect, it } from "vitest";
import { sampleTemplate } from "./sampleTemplate";

const page = (id: string) =>
  sampleTemplate.pages.find((candidate) => candidate.id === id)!;

describe("native static-page headers", () => {
  it.each([
    ["data-methodology", "DATA METHODOLOGY"],
    ["definitions", "DEFINITIONS"],
  ])(
    "extracts the editable %s logo, title, and dynamic period",
    (id, title) => {
      const elements = page(id).elements;
      expect(
        elements.filter((element) => element.id === `${id}-logo`),
      ).toHaveLength(1);
      expect(
        elements.filter((element) => element.id === `${id}-title`),
      ).toEqual([expect.objectContaining({ type: "text", text: title })]);
      expect(
        elements.filter((element) => element.id === `${id}-period`),
      ).toEqual([
        expect.objectContaining({
          type: "text",
          name: "Report Period",
          binding: { path: "reportDisplay.period" },
        }),
      ]);
      expect(
        elements.filter((element) => element.id === `${id}-header-mask`),
      ).toHaveLength(1);
    },
  );

  it("extracts only the requested Contacts logo and period", () => {
    const elements = page("contacts").elements;
    expect(
      elements.filter((element) => element.id === "contacts-logo"),
    ).toHaveLength(1);
    expect(
      elements.filter((element) => element.id === "contacts-period"),
    ).toEqual([
      expect.objectContaining({
        type: "text",
        binding: { path: "reportDisplay.period" },
      }),
    ]);
    expect(elements.some((element) => element.id === "contacts-title")).toBe(
      false,
    );
  });

  it.each([
    ["data-methodology", 41],
    ["definitions", 42],
    ["contacts", 43],
    ["who-we-are", 44],
  ])("promotes every %s footer text block to native elements", (id, number) => {
    const elements = page(id).elements;
    expect(
      elements.find((element) => element.id === `${id}-footer-mask`),
    ).toMatchObject({
      type: "shape",
      locked: true,
      x: 0,
      y: 1020,
      width: 816,
      height: 36,
    });
    expect(
      elements.find((element) => element.id === `${id}-footer-brand`),
    ).toMatchObject({
      type: "text",
      name: "Footer Brand",
      text: "LEE & ASSOCIATES OF ILLINOIS",
    });
    expect(
      elements.find((element) => element.id === `${id}-footer-address`),
    ).toMatchObject({
      type: "text",
      name: "Footer Address",
      text: "9450 W. BRYN MAWR AVE, SUITE 550 | ROSEMONT, IL 60018",
    });
    expect(
      elements.find((element) => element.id === `${id}-footer-page-number`),
    ).toMatchObject({
      type: "text",
      name: "Footer Page Number",
      text: String(number),
    });
  });
});
