import { describe, expect, it } from "vitest";
import { sampleTemplate } from "./sampleTemplate";
import type { TableElement } from "../types/report";

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
  it.each([
    ["market-overview", "top-leases-table"],
    ["market-overview", "top-sales-table"],
    ["submarket-overview", "detail-top-leases-table"],
    ["submarket-overview", "detail-top-sales-table"],
  ])(
    "widens the type column on %s / %s without changing table size",
    (pageId, tableId) => {
      const table = transactionTable(pageId, tableId);

      expect(table).toMatchObject({ width: 729, height: 114, maxRows: 3 });
      expect(table.columns.map(({ key, width }) => ({ key, width }))).toEqual([
        { key: "party", width: 26 },
        { key: "amount", width: 15 },
        { key: "address", width: 39 },
        { key: "type", width: 20 },
      ]);
    },
  );
});
