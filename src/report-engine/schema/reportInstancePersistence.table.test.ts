import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../../data/sampleTemplate";
import { generateReportInstance } from "../generation/generateReport";
import type { TableElement } from "../../types/report";
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

const findTable = (
  pages: { elements: { id: string; type: string }[] }[],
  id: string,
) => {
  for (const page of pages) {
    const found = page.elements.find((element) => element.id === id);
    if (found) return found as unknown as TableElement;
  }
  throw new Error(`Table ${id} not found in fixture.`);
};

describe("table appearance persistence", () => {
  it("keeps an existing table without any of the new style fields valid", async () => {
    const instance = await fixture();
    // The sample template's own tables predate this feature and set none of
    // the new fields — normalization must accept them exactly as-is.
    expect(() => normalizeReportInstance(instance)).not.toThrow();
    const normalized = normalizeReportInstance(instance);
    const table = findTable(normalized.pages, "top-leases-table");
    expect(table.headerBevel).toBeUndefined();
    expect(table.headerCornerRadius).toBeUndefined();
    expect(table.headerRibbonId).toBeUndefined();
    expect(table.totalStyle).toBeUndefined();
  });

  it("serializes and deserializes the new table appearance fields", async () => {
    const instance = await fixture();
    const styled = structuredClone(instance);
    const page = styled.pages.find((candidate) =>
      candidate.elements.some((element) => element.id === "top-leases-table"),
    )!;
    const table = page.elements.find(
      (element) => element.id === "top-leases-table",
    ) as unknown as TableElement;
    Object.assign(table, {
      style: { ...table.style, shadow: { enabled: true, color: "#000000", offsetX: 1, offsetY: 2, blur: 3, opacity: 0.3, spread: 1 } },
      totalStyle: { color: "#ffffff", shadow: { enabled: true, color: "#123456", offsetX: 0, offsetY: 1, blur: 2, opacity: 0.5 } },
      headerBevel: {
        enabled: true,
        size: 3,
        direction: "raised",
        highlightColor: "#ffffff",
        highlightOpacity: 0.5,
        shadowColor: "#000000",
        shadowOpacity: 0.25,
      },
      headerCornerRadius: 6,
      headerRibbonId: "leases-side-bg",
    } satisfies Partial<TableElement>);

    const serialized = serializeReportInstance(styled);
    const restored = normalizeReportInstance(JSON.parse(serialized));
    const restoredTable = findTable(restored.pages, "top-leases-table");
    expect(restoredTable.headerBevel).toEqual({
      enabled: true,
      size: 3,
      direction: "raised",
      highlightColor: "#ffffff",
      highlightOpacity: 0.5,
      shadowColor: "#000000",
      shadowOpacity: 0.25,
    });
    expect(restoredTable.headerCornerRadius).toBe(6);
    expect(restoredTable.headerRibbonId).toBe("leases-side-bg");
    expect(restoredTable.totalStyle?.shadow?.color).toBe("#123456");
    expect(restoredTable.style.shadow?.spread).toBe(1);
  });

  it("keeps an existing table without any row-shadow fields valid (backward compatible)", async () => {
    const instance = await fixture();
    const normalized = normalizeReportInstance(instance);
    const table = findTable(normalized.pages, "top-leases-table");
    expect(table.headerRowShadow).toBeUndefined();
    expect(table.rowKindShadows).toBeUndefined();
    expect(table.bodyRowShadows).toBeUndefined();
  });

  it("serializes and deserializes headerRowShadow, rowKindShadows, and bodyRowShadows", async () => {
    const instance = await fixture();
    const styled = structuredClone(instance);
    const page = styled.pages.find((candidate) =>
      candidate.elements.some((element) => element.id === "top-leases-table"),
    )!;
    const table = page.elements.find(
      (element) => element.id === "top-leases-table",
    ) as unknown as TableElement;
    const shadow = {
      enabled: true,
      color: "#123456",
      offsetX: 0,
      offsetY: 2,
      blur: 4,
      opacity: 0.3,
    };
    Object.assign(table, {
      headerRowShadow: shadow,
      rowKindShadows: { total: { ...shadow, color: "#abcdef" } },
      bodyRowShadows: { "3": { ...shadow, color: "#fedcba" } },
    } satisfies Partial<TableElement>);

    const serialized = serializeReportInstance(styled);
    const restored = normalizeReportInstance(JSON.parse(serialized));
    const restoredTable = findTable(restored.pages, "top-leases-table");
    expect(restoredTable.headerRowShadow).toEqual(shadow);
    expect(restoredTable.rowKindShadows).toEqual({
      total: { ...shadow, color: "#abcdef" },
    });
    expect(restoredTable.bodyRowShadows).toEqual({
      "3": { ...shadow, color: "#fedcba" },
    });
  });

  it("rejects an unknown field on a row-shadow record (strict schema)", async () => {
    const instance = await fixture();
    const tampered = structuredClone(instance) as unknown as {
      pages: { elements: Record<string, unknown>[] }[];
    };
    const table = tampered.pages
      .flatMap((page) => page.elements)
      .find((element) => element.id === "top-leases-table")!;
    table.rowKindShadows = { total: { enabled: true, notARealField: 1 } };
    expect(() => normalizeReportInstance(tampered)).toThrow();
  });
});
