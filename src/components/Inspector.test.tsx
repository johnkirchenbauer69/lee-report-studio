import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Inspector } from "./Inspector";
import type { ReportElement, TableElement } from "../types/report";

const table: TableElement = {
  id: "top-leases-table",
  type: "table",
  name: "Top Leases",
  x: 55,
  y: 0,
  width: 729,
  height: 114,
  sourcePath: "rows",
  variant: "transactions",
  columns: [
    { key: "party", label: "TENANT", path: "party" },
    { key: "type", label: "LEASE TYPE", path: "type" },
  ],
  style: {},
};

const ribbon: ReportElement = {
  id: "leases-side-bg",
  type: "shape",
  name: "Section Side Bar",
  x: 32,
  y: 0,
  width: 23,
  height: 114,
  style: {},
};

const noop = () => undefined;

const renderInspector = (
  element: ReportElement | undefined,
  pageElements: ReportElement[] = [],
) =>
  renderToStaticMarkup(
    <Inspector
      element={element}
      unit="px"
      selectionCount={element ? 1 : 0}
      pageElements={pageElements}
      onChange={noop}
      onAlign={noop}
      onDistribute={noop}
    />,
  );

describe("Inspector table appearance controls", () => {
  it("shows Table Shadow, Header Appearance, and Text Effects for a selected table", () => {
    const markup = renderInspector(table, [table, ribbon]);
    expect(markup).toContain("Table Shadow");
    expect(markup).toContain("Header Appearance");
    expect(markup).toContain("Text Effects");
    expect(markup).toContain("Header text shadow");
    expect(markup).toContain("Body text shadow");
  });

  it("hides totals text shadow when the table has no rowKindPath", () => {
    const markup = renderInspector(table);
    expect(markup).not.toContain("Totals text shadow");
  });

  it("shows totals text shadow once the table has a rowKindPath", () => {
    const markup = renderInspector({ ...table, rowKindPath: "kind" });
    expect(markup).toContain("Totals text shadow");
  });

  it("does not show table-only sections for a non-table element", () => {
    const markup = renderInspector(ribbon);
    expect(markup).not.toContain("Header Appearance");
    expect(markup).not.toContain("Text Effects");
    expect(markup).toContain("Drop Shadow");
    expect(markup).not.toContain("Table Shadow");
  });

  it("reflects the table's current header bevel, corner radius, and shadow state", () => {
    const styled: TableElement = {
      ...table,
      headerBevel: {
        enabled: true,
        size: 4,
        direction: "inset",
        highlightColor: "#ffffff",
        highlightOpacity: 0.5,
        shadowColor: "#000000",
        shadowOpacity: 0.25,
      },
      headerCornerRadius: 8,
      headerStyle: {
        shadow: { enabled: true, color: "#123456", offsetX: 1, offsetY: 2, blur: 3, opacity: 0.4 },
      },
    };
    const markup = renderInspector(styled);
    expect(markup).toContain('aria-label="Header Bevel" type="checkbox" checked=""');
    expect(markup).toContain('aria-label="Header corner radius"');
    expect(markup).toContain('value="8"');
    expect(markup).toContain('aria-label="Header Text Shadow" type="checkbox" checked=""');
    expect(markup).toContain('aria-label="Header Text Shadow X Offset"');
  });

  it("lists sibling shapes as ribbon link candidates and excludes the table itself", () => {
    const other: ReportElement = { ...ribbon, id: "other-shape", name: "Other Shape" };
    const markup = renderInspector(table, [table, ribbon, other]);
    expect(markup).toContain('value="leases-side-bg"');
    expect(markup).toContain("Section Side Bar");
    expect(markup).toContain('value="other-shape"');
    expect(markup).not.toContain('value="top-leases-table">');
  });

  it("marks the currently linked ribbon as selected in the dropdown", () => {
    const linked: TableElement = { ...table, headerRibbonId: "leases-side-bg" };
    const markup = renderInspector(linked, [linked, ribbon]);
    expect(markup).toMatch(/<option value="leases-side-bg" selected="">/);
  });
});
