import type {
  BevelStyle,
  ReportElement,
  ShapeElement,
  TableElement,
} from "../types/report";
import { directionalBevelToCss, type BevelEdges } from "./effects";

export type HeaderGroupSide = "left" | "right";

export interface HeaderGroup {
  ribbon: ShapeElement;
  side: HeaderGroupSide;
}

/**
 * Finds the sibling shape a table has linked as its continuous header
 * ribbon (e.g. the "TOP LEASES" side bar), and which side of the table it
 * sits on. Side is derived from geometry already present on both elements —
 * no runtime measurement, so this is stable across editor, preview, and PDF.
 */
export function resolveHeaderGroup(
  table: TableElement,
  elements: readonly ReportElement[],
): HeaderGroup | undefined {
  if (!table.headerRibbonId) return undefined;
  const ribbon = elements.find(
    (item): item is ShapeElement =>
      item.id === table.headerRibbonId && item.type === "shape",
  );
  if (!ribbon) return undefined;
  const side: HeaderGroupSide =
    ribbon.x + ribbon.width <= table.x + table.width / 2 ? "left" : "right";
  return { ribbon, side };
}

/** Finds the table (if any) that has linked `element` as its header ribbon. */
export function findLinkedTable(
  element: ReportElement,
  elements: readonly ReportElement[],
): TableElement | undefined {
  return elements.find(
    (item): item is TableElement =>
      item.type === "table" && item.headerRibbonId === element.id,
  );
}

/**
 * Box-shadow for a header <th>: top and bottom edges only. Applied
 * identically to every header cell in a row, this composes into one
 * continuous bar rather than a shadow around each individual cell, since
 * neither the left nor right edge of any cell ever receives a shadow layer.
 */
export function headerCellBoxShadow(
  bevel?: BevelStyle,
): string | undefined {
  return directionalBevelToCss(bevel, {
    top: true,
    bottom: true,
    left: false,
    right: false,
  });
}

/**
 * Corner radius for one header <th>, given its position in the row and
 * whether the table's header is grouped with a side ribbon. Only true outer
 * corners round; a corner touching a linked ribbon is suppressed so the
 * internal join stays a plain right angle.
 */
export function headerCellCornerRadius(
  radius: number | undefined,
  position: { isFirst: boolean; isLast: boolean },
  group?: HeaderGroup,
): string | undefined {
  if (!radius) return undefined;
  const topLeftSuppressed = group?.side === "left" && position.isFirst;
  const topRightSuppressed = group?.side === "right" && position.isLast;
  const topLeft = position.isFirst && !topLeftSuppressed ? radius : 0;
  const topRight = position.isLast && !topRightSuppressed ? radius : 0;
  if (!topLeft && !topRight) return undefined;
  return `${topLeft}px ${topRight}px 0 0`;
}

/**
 * Top-left/top-right radius for the table's own header-clip WRAPPER (see
 * CanvasElement's table rendering) -- the same values `headerCellCornerRadius`
 * would use for the first/last header <th>, but computed once for the whole
 * header perimeter rather than per cell, and only ever touching the two top
 * corners (bottom stays square, matching the existing per-cell behavior).
 * Returns undefined when there is nothing to round (radius unset/0), so
 * callers can skip rendering the wrapper entirely and keep the unrounded
 * path byte-for-byte identical to before this wrapper existed.
 */
export function headerWrapperCornerRadii(
  radius: number | undefined,
  group?: HeaderGroup,
): { topLeft: number; topRight: number } | undefined {
  if (!radius) return undefined;
  const topLeftSuppressed = group?.side === "left";
  const topRightSuppressed = group?.side === "right";
  return {
    topLeft: topLeftSuppressed ? 0 : radius,
    topRight: topRightSuppressed ? 0 : radius,
  };
}

/**
 * Box-shadow and border-radius to apply to a ribbon shape while it is
 * linked as a table's header ribbon. The edge and corner shared with the
 * header are suppressed so the two elements read as one continuous raised
 * surface instead of two independently-beveled boxes with a visible seam.
 */
export function ribbonGroupStyle(
  bevel: BevelStyle | undefined,
  cornerRadius: number | undefined,
  side: HeaderGroupSide,
): { boxShadow?: string; borderRadius?: string } {
  const sharedEdge: keyof BevelEdges = side === "left" ? "right" : "left";
  const edges: BevelEdges = { top: true, bottom: true, left: true, right: true };
  edges[sharedEdge] = false;
  const boxShadow = directionalBevelToCss(bevel, edges);
  const radius = cornerRadius ?? 0;
  // CSS border-radius shorthand order: top-left, top-right, bottom-right,
  // bottom-left. The corner adjacent to the header (top-right when the
  // ribbon is on the left; top-left when it's on the right) stays square.
  const borderRadius = radius
    ? side === "left"
      ? `${radius}px 0 ${radius}px ${radius}px`
      : `0 ${radius}px ${radius}px ${radius}px`
    : undefined;
  return { boxShadow, borderRadius };
}
