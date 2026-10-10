import { describe, expect, it } from "vitest";
import { upsertManualOverride } from "./reportDocumentHistory";
import { findTableValueOverride, tableCellKey, tableCellDisplayValue, withTableDisplayOverrides, isPlainDisplayValue } from "./tableValueOverrides";
import type { TableElement } from "../types/report";
import { manualOverrideSchema } from "../report-engine/schema/reportInstancePersistence";

const table: TableElement = {
  id: "indicators", type: "table", name: "Indicators", x: 0, y: 0, width: 400, height: 120,
  sourcePath: "indicatorRows", variant: "indicators", style: {}, columns: [
    { key: "metric", label: "Metric", path: "metric" },
    { key: "prior", label: "Q3 2025", path: "prior" },
    { key: "q2", label: "Q3 2026", path: "q2" },
  ],
};
const row = { metricKey: "trailing12MonthNetAbsorptionSf", metric: "12 Month Net Absorption (SF)", prior: null, q2: "19,417,314" };
const data = { indicatorRows: [row, { metricKey: "vacancyRate", prior: "6.28%" }],
  historicalPeriods: ["2026 Q3", "2026 Q2", "2026 Q1", "2025 Q4", "2025 Q3"].map((period) => ({ period })) };
const column = table.columns[1]!;
const cellKey = tableCellKey(table, row, column, data)!;
const override = { elementId: table.id, cellKey, bindingPath: "indicatorRows.prior", generatedValue: null,
  overrideValue: "18,086,895", createdAt: "2026-10-06T12:00:00.000Z" };

describe("table display overrides", () => {
  it("renders source or unavailable with no override, and only replaces the chosen cell", () => {
    const before = structuredClone(data);
    expect(tableCellDisplayValue(table, row, column, data)).toBe("—");
    expect(tableCellDisplayValue(table, row, table.columns[2]!, data)).toBe("19,417,314");
    const rendered = withTableDisplayOverrides(data, [override]);
    expect(tableCellDisplayValue(table, row, column, rendered)).toBe("18,086,895");
    expect(tableCellDisplayValue(table, data.indicatorRows[1], column, rendered)).toBe("6.28%");
    expect(tableCellDisplayValue(table, row, table.columns[2]!, rendered)).toBe("19,417,314");
    expect(data).toEqual(before);
    expect(rendered.indicatorRows).toBe(data.indicatorRows);
  });
  it("keeps identity through row/column reordering and follows the actual quarter across report periods", () => {
    const moved = { ...data, indicatorRows: [...data.indicatorRows].reverse() };
    expect(tableCellKey({ ...table, columns: [...table.columns].reverse() }, row, column, moved)).toBe(cellKey);
    const shifted = { ...data, historicalPeriods: ["2026 Q2", "2026 Q1", "2025 Q4", "2025 Q3", "2025 Q2"].map((period) => ({ period })) };
    const sameQuarterColumn = { key: "q3", label: "Q3 2025", path: "q3" };
    expect(tableCellKey({ ...table, columns: [sameQuarterColumn] }, row, sameQuarterColumn, shifted)).toBe(cellKey);
    expect(tableCellKey(table, row, column, shifted)).not.toBe(cellKey);
  });
  it("retains original value and counts cells independently, then reverts without copying source", () => {
    let values = upsertManualOverride([], override);
    expect(values).toHaveLength(1);
    values = upsertManualOverride(values, { ...override, cellKey: "other-cell", overrideValue: "other" });
    expect(values).toHaveLength(2);
    expect(findTableValueOverride(table, row, column, data, values)?.generatedValue).toBeNull();
    values = values.filter((item) => item.cellKey !== cellKey);
    expect(tableCellDisplayValue(table, row, column, data, values)).toBe("—");
    expect(tableCellDisplayValue(table, { ...row, prior: "12,345" }, column, data, values)).toBe("12,345");
    expect(values).toHaveLength(1);
  });
  it("serializes semantic keys and plain text but rejects formulas", () => {
    expect(manualOverrideSchema.parse(JSON.parse(JSON.stringify(override)))).toEqual(override);
    for (const value of ["=SUM(A1:A4)", "+A1", "@SUM(A1)"]) {
      expect(isPlainDisplayValue(value)).toBe(false);
      expect(manualOverrideSchema.safeParse({ ...override, overrideValue: value }).success).toBe(false);
    }
    expect(isPlainDisplayValue("-292,656")).toBe(true);
    expect(tableCellDisplayValue(table, row, column, data, [{ ...override, overrideValue: "" }])).toBe("");
  });
  it("refuses missing or duplicate identities", () => {
    expect(tableCellKey(table, row, column, { ...data, indicatorRows: [row, row] })).toBeUndefined();
    expect(tableCellKey(table, {}, column, data)).toBeUndefined();
  });
});
