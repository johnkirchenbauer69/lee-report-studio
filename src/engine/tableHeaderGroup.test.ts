import { describe, expect, it } from "vitest";
import type { ShapeElement, TableElement } from "../types/report";
import {
  findLinkedTable,
  headerCellBoxShadow,
  headerCellCornerRadius,
  headerWrapperCornerRadii,
  resolveHeaderGroup,
  ribbonGroupStyle,
} from "./tableHeaderGroup";

const bevel = {
  enabled: true,
  size: 3,
  direction: "raised" as const,
  highlightColor: "#ffffff",
  highlightOpacity: 0.5,
  shadowColor: "#000000",
  shadowOpacity: 0.25,
};

const ribbon: ShapeElement = {
  id: "leases-side-bg",
  type: "shape",
  name: "Section Side Bar",
  x: 32,
  y: 762,
  width: 23,
  height: 114,
  style: {},
};

const table: TableElement = {
  id: "top-leases-table",
  type: "table",
  name: "Top Leases",
  x: 55,
  y: 762,
  width: 729,
  height: 114,
  sourcePath: "topLeaseRows",
  columns: [],
  style: {},
  headerRibbonId: "leases-side-bg",
  headerBevel: bevel,
  headerCornerRadius: 6,
};

describe("resolveHeaderGroup", () => {
  it("finds the linked ribbon and determines it sits to the left", () => {
    const group = resolveHeaderGroup(table, [table, ribbon]);
    expect(group?.ribbon.id).toBe("leases-side-bg");
    expect(group?.side).toBe("left");
  });

  it("determines a ribbon positioned after the table sits to the right", () => {
    const rightRibbon: ShapeElement = { ...ribbon, id: "right-ribbon", x: 800 };
    const rightTable: TableElement = {
      ...table,
      headerRibbonId: "right-ribbon",
      x: 55,
      width: 729,
    };
    const group = resolveHeaderGroup(rightTable, [rightTable, rightRibbon]);
    expect(group?.side).toBe("right");
  });

  it("is undefined when there is no link, or the link does not resolve to a shape", () => {
    expect(resolveHeaderGroup({ ...table, headerRibbonId: undefined }, [table, ribbon])).toBeUndefined();
    expect(resolveHeaderGroup(table, [table])).toBeUndefined();
    expect(
      resolveHeaderGroup(table, [table, { ...ribbon, id: "leases-side-bg", type: "text", text: "x" } as never]),
    ).toBeUndefined();
  });
});

describe("findLinkedTable", () => {
  it("finds the table that links to a given element", () => {
    expect(findLinkedTable(ribbon, [table, ribbon])?.id).toBe("top-leases-table");
  });

  it("is undefined when nothing links to the element", () => {
    expect(findLinkedTable(ribbon, [ribbon])).toBeUndefined();
  });
});

describe("headerCellBoxShadow", () => {
  it("is undefined when the bevel is disabled", () => {
    expect(headerCellBoxShadow(undefined)).toBeUndefined();
    expect(headerCellBoxShadow({ ...bevel, enabled: false })).toBeUndefined();
  });

  it("never includes a left/right edge shadow, so adjacent cells never seam", () => {
    const css = headerCellBoxShadow(bevel)!;
    expect(css).toContain("inset 0 3px");
    expect(css).toContain("inset 0 -3px");
    expect(css).not.toMatch(/inset -?3px 0/);
  });
});

describe("headerCellCornerRadius", () => {
  it("rounds both outer corners for a standalone header", () => {
    expect(headerCellCornerRadius(6, { isFirst: true, isLast: false })).toBe("6px 0px 0 0");
    expect(headerCellCornerRadius(6, { isFirst: false, isLast: true })).toBe("0px 6px 0 0");
  });

  it("rounds both corners of a single-column header", () => {
    expect(headerCellCornerRadius(6, { isFirst: true, isLast: true })).toBe("6px 6px 0 0");
  });

  it("never rounds a middle cell", () => {
    expect(headerCellCornerRadius(6, { isFirst: false, isLast: false })).toBeUndefined();
  });

  it("is undefined when radius is 0 or unset", () => {
    expect(headerCellCornerRadius(0, { isFirst: true, isLast: true })).toBeUndefined();
    expect(headerCellCornerRadius(undefined, { isFirst: true, isLast: true })).toBeUndefined();
  });

  it("suppresses the corner touching a linked left-side ribbon", () => {
    const group = { ribbon, side: "left" as const };
    expect(headerCellCornerRadius(6, { isFirst: true, isLast: false }, group)).toBeUndefined();
    expect(headerCellCornerRadius(6, { isFirst: false, isLast: true }, group)).toBe("0px 6px 0 0");
  });

  it("suppresses the corner touching a linked right-side ribbon", () => {
    const group = { ribbon, side: "right" as const };
    expect(headerCellCornerRadius(6, { isFirst: true, isLast: false }, group)).toBe("6px 0px 0 0");
    expect(headerCellCornerRadius(6, { isFirst: false, isLast: true }, group)).toBeUndefined();
  });
});

describe("headerWrapperCornerRadii", () => {
  it("is undefined when radius is 0 or unset, so the unrounded path renders no wrapper", () => {
    expect(headerWrapperCornerRadii(undefined)).toBeUndefined();
    expect(headerWrapperCornerRadii(0)).toBeUndefined();
  });

  it("rounds both top corners for a standalone header", () => {
    expect(headerWrapperCornerRadii(6)).toEqual({ topLeft: 6, topRight: 6 });
  });

  it("suppresses the corner touching a linked left-side ribbon", () => {
    expect(headerWrapperCornerRadii(6, { ribbon, side: "left" })).toEqual({
      topLeft: 0,
      topRight: 6,
    });
  });

  it("suppresses the corner touching a linked right-side ribbon", () => {
    expect(headerWrapperCornerRadii(6, { ribbon, side: "right" })).toEqual({
      topLeft: 6,
      topRight: 0,
    });
  });
});

describe("ribbonGroupStyle", () => {
  it("suppresses the shared right edge and the touching top-right corner for a left-side ribbon", () => {
    const { boxShadow, borderRadius } = ribbonGroupStyle(bevel, 6, "left");
    expect(boxShadow).not.toMatch(/inset -3px 0/); // right edge suppressed
    expect(boxShadow).toContain("inset 3px 0"); // left edge present
    expect(boxShadow).toContain("inset 0 3px"); // top edge present
    expect(boxShadow).toContain("inset 0 -3px"); // bottom edge present
    expect(borderRadius).toBe("6px 0 6px 6px");
  });

  it("suppresses the shared left edge and the touching top-left corner for a right-side ribbon", () => {
    const { boxShadow, borderRadius } = ribbonGroupStyle(bevel, 6, "right");
    expect(boxShadow).not.toMatch(/inset 3px 0/); // left edge suppressed
    expect(boxShadow).toContain("inset -3px 0"); // right edge present
    expect(borderRadius).toBe("0 6px 6px 6px");
  });

  it("omits border-radius when no radius is configured", () => {
    expect(ribbonGroupStyle(bevel, undefined, "left").borderRadius).toBeUndefined();
    expect(ribbonGroupStyle(bevel, 0, "left").borderRadius).toBeUndefined();
  });
});
