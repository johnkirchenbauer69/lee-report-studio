import { formatValue, getByContextPath, getByPath } from "./bindings";
import type { ManualOverride } from "../report-engine/schema/generation";
import type { TableColumn, TableElement } from "../types/report";

const rowIdentity = (row: unknown): string | undefined => {
  for (const path of ["metricKey", "id", "geographyId", "externalId"]) {
    const value = getByPath(row, path);
    if (value != null && String(value).trim()) return `${path}:${value}`;
  }
  const address = getByPath(row, "address");
  if (address) return JSON.stringify(["transaction", address, getByPath(row, "party"), getByPath(row, "type")]);
  const name = getByPath(row, "name");
  return name ? `name:${name}` : undefined;
};

/** Refuse ambiguous rows rather than attach a value to a positional index. */
export function tableCellKey(table: TableElement, row: unknown, column: TableColumn, data: unknown) {
  const rows = getByContextPath(data, table.sourcePath, table.bindingContext);
  const identity = rowIdentity(row);
  if (!identity || !Array.isArray(rows) || rows.filter((item) => rowIdentity(item) === identity).length !== 1)
    return undefined;
  if (table.columns.filter((item) => item.key === column.key).length !== 1) return undefined;
  let columnIdentity = column.key;
  if (table.variant === "indicators") {
    const index = ["q2", "q1", "q4", "q3", "prior"].indexOf(column.path);
    if (index >= 0) {
      const historyPath = table.sourcePath.replace(/indicatorRows$/, "historicalPeriods");
      const history = getByContextPath(data, historyPath, table.bindingContext);
      const period = Array.isArray(history) ? getByPath(history[index], "period") : undefined;
      if (!period) return undefined;
      columnIdentity = `period:${period}`;
    }
  }
  return JSON.stringify([identity, columnIdentity]);
}

export const tableOverridesFromData = (data: unknown): ManualOverride[] => {
  const value = getByPath(data, "__tableDisplayOverrides");
  return Array.isArray(value) ? value : [];
};

export function findTableValueOverride(table: TableElement, row: unknown, column: TableColumn, data: unknown,
  overrides: ManualOverride[] = tableOverridesFromData(data)) {
  const cellKey = tableCellKey(table, row, column, data);
  return cellKey ? overrides.find((item) => item.elementId === table.id && item.cellKey === cellKey) : undefined;
}

export function tableCellDisplayValue(table: TableElement, row: unknown, column: TableColumn, data: unknown,
  overrides?: ManualOverride[]) {
  const override = findTableValueOverride(table, row, column, data, overrides);
  return override ? String(override.overrideValue ?? "") : formatValue(getByPath(row, column.path), {
    path: column.path, format: column.format, decimals: column.decimals ?? 1,
  });
}

/** Render-only envelope; never store this on dataSnapshot or send it to MCP. */
export const withTableDisplayOverrides = <T extends object>(data: T, overrides: ManualOverride[]) => ({
  ...data, __tableDisplayOverrides: overrides.filter((item) => item.cellKey),
});

export const isPlainDisplayValue = (value: string) => !/^\s*[=+@]/.test(value);
