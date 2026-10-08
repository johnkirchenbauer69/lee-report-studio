import { describe, expect, it } from "vitest";
import { sampleTemplate } from "./sampleTemplate";
import type { TableElement, ReportPage } from "../types/report";

const transactionTable = (pageId: string, tableId: string) => {
  const page = sampleTemplate.pages.find(
    (candidate) => candidate.id === pageId,
  );
  const element = page?.elements.find(
    (candidate) => candidate.id === tableId,
  ) as TableElement | undefined;
  expect(element?.type).toBe("table");
  return element!;
};

describe("transaction table column geometry", () => {
  const SHARED_GRID_WIDTHS = [22, 20, 32, 26];

  it.each([
    ["market-overview", "top-leases-table"],
    ["submarket-overview", "detail-top-leases-table"],
  ])(
    "uses the shared 22/20/32/26 column grid and a SIZE header on %s / %s without changing table size",
    (pageId, tableId) => {
      const table = transactionTable(pageId, tableId);

      expect(table).toMatchObject({ width: 729, height: 114, maxRows: 3 });
      expect(
        table.columns.map(({ key, width, label }) => ({ key, width, label })),
      ).toEqual([
        { key: "party", width: 22, label: "TENANT" },
        { key: "amount", width: 20, label: "SIZE" },
        { key: "address", width: 32, label: "ADDRESS" },
        { key: "type", width: 26, label: "LEASE TYPE" },
      ]);
    },
  );

  it.each([
    ["market-overview", "top-sales-table"],
    ["submarket-overview", "detail-top-sales-table"],
  ])(
    "replaces PRICE ($) with a combined SIZE / PRICE column on %s / %s, keeping exactly 4 columns on the shared grid",
    (pageId, tableId) => {
      const table = transactionTable(pageId, tableId);

      expect(table).toMatchObject({ width: 729, height: 114, maxRows: 3 });
      expect(table.columns).toHaveLength(4);
      expect(
        table.columns.map(({ key, width, label }) => ({ key, width, label })),
      ).toEqual([
        { key: "party", width: 22, label: "BUYER" },
        { key: "sizePricePerSf", width: 20, label: "SIZE / PRICE" },
        { key: "address", width: 32, label: "ADDRESS" },
        { key: "type", width: 26, label: "SALE TYPE" },
      ]);
      expect(table.columns.some((column) => column.key === "amount")).toBe(
        false,
      );
      expect(
        table.columns.reduce((sum, column) => sum + (column.width ?? 0), 0),
      ).toBe(100);
    },
  );

  it("aligns Top Leases and Top Sales column starts on both Market Overview and submarket pages", () => {
    for (const [leasesId, salesId] of [
      ["top-leases-table", "top-sales-table"],
      ["detail-top-leases-table", "detail-top-sales-table"],
    ]) {
      const leases = transactionTable(
        leasesId.startsWith("detail") ? "submarket-overview" : "market-overview",
        leasesId,
      );
      const sales = transactionTable(
        salesId.startsWith("detail") ? "submarket-overview" : "market-overview",
        salesId,
      );
      expect(leases.x).toBe(sales.x);
      expect(leases.columns.map((c) => c.width)).toEqual(
        sales.columns.map((c) => c.width),
      );
      expect(leases.columns.map((c) => c.width)).toEqual(SHARED_GRID_WIDTHS);
    }
  });
});

describe("property-card layering on Market Highlights pages", () => {
  const sectionIds = ["availability", "deliveries", "construction"];

  function assertBarAndTitleAfterCards(page: ReportPage, prefix: string) {
    for (const section of sectionIds) {
      const key = `${prefix}${section}`;
      const barIndex = page.elements.findIndex((e) => e.id === `${key}-bar`);
      const titleIndex = page.elements.findIndex(
        (e) => e.id === `${key}-section-title`,
      );
      const cardIndices = page.elements
        .map((e, index) => ({ id: e.id, index }))
        .filter(({ id }) => id.startsWith(`${key}-image-`))
        .map(({ index }) => index);
      expect(barIndex).toBeGreaterThan(-1);
      expect(titleIndex).toBeGreaterThan(-1);
      for (const cardIndex of cardIndices) {
        expect(barIndex).toBeGreaterThan(cardIndex);
        expect(titleIndex).toBeGreaterThan(cardIndex);
      }
    }
  }

  it("renders the beveled bar/title after (on top of) every property image on the Overall Market highlights page", () => {
    const page = sampleTemplate.pages.find(
      (p) => p.id === "market-highlights",
    )!;
    assertBarAndTitleAfterCards(page, "");
  });

  it("renders the beveled bar/title after (on top of) every property image on the submarket highlights page", () => {
    const page = sampleTemplate.pages.find(
      (p) => p.id === "submarket-highlights",
    )!;
    assertBarAndTitleAfterCards(page, "detail-");
  });
});
