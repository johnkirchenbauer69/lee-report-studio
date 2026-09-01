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
});
