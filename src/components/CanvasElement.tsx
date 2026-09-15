import React, { useEffect, useRef, useState } from "react";
import type {
  EditorSettings,
  ImageCrop,
  PreviewMode,
  ReportElement,
  ReportPage,
  TableCellStyle,
  TableElement,
  TableSelection,
  ShapeElement,
} from "../types/report";
import type { SnapGuide } from "../engine/editorMath";
import { fillToCss, snapPosition } from "../engine/editorMath";
import { formatValue, getByContextPath, getByPath } from "../engine/bindings";
import { NativeChart } from "../report-engine/charts/NativeChart";
import { normalizeRotation, snapRotation } from "../engine/geometry";
import { getRotatedAabb, elementRect } from "../engine/geometry";
import {
  resolveTypography,
  verticalAlignmentClass,
} from "../engine/typography";
import { fontFamilyToCss } from "../services/fontRegistry";
import {
  directionalDropShadowToCss,
  dropShadowToCss,
  elementBoxShadowToCss,
  flattenAlphaForPrint,
  resolveBevel,
  resolveDropShadow,
} from "../engine/effects";
import {
  cornerRadiiToCss,
  resolveCornerRadii,
  updateCornerRadius,
  type CornerKey,
} from "../engine/corners";
import { shapePathToSvg } from "../engine/shapeUnion";
import {
  findLinkedTable,
  headerCellBoxShadow,
  headerCellCornerRadius,
  headerWrapperCornerRadii,
  resolveHeaderGroup,
  ribbonGroupStyle,
} from "../engine/tableHeaderGroup";
import type { ManualOverride } from "../report-engine/schema/generation";
import { resolveOverviewPageTarget } from "../report-engine/navigation/pageNavigation";

interface Props {
  element: ReportElement;
  elements: ReportElement[];
  pageSize: { width: number; height: number };
  settings: EditorSettings;
  data: unknown;
  manualOverrides?: ManualOverride[];
  mode: PreviewMode;
  selected: boolean;
  selectedIds?: string[];
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (id: string, patch: Partial<ReportElement>) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onGuides: (guides: SnapGuide[]) => void;
  readOnly?: boolean;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  cropping?: boolean;
  tableEditing?: boolean;
  tableSelection?: TableSelection;
  onEnterTableEdit?: (id: string) => void;
  onTableSelect?: (selection: TableSelection) => void;
  pages?: readonly ReportPage[];
  onNavigatePage?: (pageId: string) => void;
  /**
   * Fired when interactive crop mode should COMMIT the in-progress crop and
   * exit (Enter key, double-click). The parent is expected to respond by
   * clearing whatever state makes `cropping` false; the temporary crop data
   * itself is written back via `onChange` from inside this component, keyed
   * off that same `cropping` prop transition -- see the crop-mode effect
   * below for the commit/cancel rule.
   */
  onCommitCrop?: (id: string) => void;
}

const DEFAULT_IMAGE_CROP: ImageCrop = { x: 50, y: 50, zoom: 1 };

/**
 * tableStyle() below always sets every output CSS key, some to `undefined`.
 * Spreading several `tableStyle(...)` calls in increasing-specificity order
 * (element -> column -> row-kind -> per-cell) would let a later, unset
 * layer's explicit `undefined` wipe out an earlier layer's real value.
 * Merging the raw TableCellStyle objects first — where an unset field is
 * simply absent, not present-and-undefined — avoids that, regardless of how
 * many layers are combined.
 */
const mergeCellStyle = (
  ...styles: (TableCellStyle | undefined)[]
): TableCellStyle => Object.assign({}, ...styles);

/**
 * Best-effort mirror of this file's own `.report-table`/`.table-<variant>`
 * CSS row/header backgrounds (see src/styles/advanced.css), used only to
 * pick a realistic backdrop for flattenAlphaForPrint below. A translucent
 * cell background composites against whatever actually paints behind that
 * cell in the browser — for the "default" variant and most rows that is
 * the page's white background, but market-matrix's striped/total/min-max
 * rows and the indicators/transactions header bands paint their own
 * non-white background, and flattening a translucent cell there against
 * white would bake in a visibly wrong (too-light) color instead of the
 * true on-screen composite. Falls back to white for anything this can't
 * resolve (the default/most common case).
 */
const resolveCellBackdrop = (
  variant: TableElement["variant"],
  section: "header" | "body",
  rowKind: string | undefined,
  rowIndex: number,
): readonly [number, number, number] => {
  const white: [number, number, number] = [255, 255, 255];
  if (variant === "market-matrix") {
    if (section === "header") return [0, 60, 80]; // .table-market-matrix th, #003c50
    if (rowKind === "total") return [143, 145, 148]; // tr.row-total, #8f9194
    if (rowKind === "minimum" || rowKind === "maximum") return [0, 60, 80]; // tr.row-minimum/-maximum, #003c50
    // tbody tr:nth-child(odd/even) — nth-child is 1-based, rowIndex is 0-based.
    return rowIndex % 2 === 0 ? [212, 214, 215] : white; // #d4d6d7 / #fff
  }
  if (section === "header") {
    if (variant === "indicators") return [206, 18, 63]; // .table-indicators th gradient, top stop #ce123f
    if (variant === "transactions") return [196, 18, 63]; // .table-transactions th, #c4123f
  }
  return white;
};

const tableStyle = (
  style?: TableCellStyle,
  backdrop?: readonly [number, number, number],
): React.CSSProperties => ({
  fontFamily: style?.fontFamily
    ? fontFamilyToCss(style.fontFamily, style.fontAssetId)
    : undefined,
  fontWeight: style?.fontWeight,
  fontSize: style?.fontSize,
  color: style?.color,
  // Flatten any alpha channel (e.g. a tinted "current quarter" highlighted
  // column authored as rgba(...)) into an opaque rgb(...) equivalent — see
  // flattenAlphaForPrint for why: a light translucent tint that composites
  // fine on screen/in a viewed PDF can fall under a physical printer's
  // minimum reproducible tint and print as plain white. `backdrop` (from
  // resolveCellBackdrop above) keeps that composite accurate for cells
  // that don't actually sit on a white background.
  background: flattenAlphaForPrint(style?.background, backdrop),
  textAlign: style?.textAlign,
  padding: style?.padding,
  borderColor: style?.borderColor,
  borderWidth: style?.borderWidth,
  borderStyle: style?.borderWidth ? "solid" : undefined,
  textShadow: dropShadowToCss(style?.shadow),
});

const strokeStyle = (element: ReportElement): React.CSSProperties => {
  const stroke = element.style.stroke;
  if (stroke?.enabled)
    return {
      borderWidth: stroke.width,
      borderStyle: stroke.style,
      borderColor: stroke.color,
    };
  return {
    borderWidth: element.style.borderWidth ?? 0,
    borderStyle: "solid",
    borderColor: element.style.borderColor ?? "transparent",
  };
};

export function CanvasElement(props: Props) {
  const {
    element,
    elements,
    pageSize,
    settings,
    data,
    mode,
    selected,
    selectedIds = [],
    zoom,
    onSelect,
    onChange,
    onGuides,
  } = props;
  const [rotationAngle, setRotationAngle] = useState<number | null>(null);

  // --- Crop mode: temporary, non-persisted state ---------------------
  //
  // While `props.cropping` is true, all interactive crop editing (pan drag,
  // zoom handles) mutates ONLY this component-local `tempCrop` -- never
  // `onChange` -- so Escape can discard it without ever having touched the
  // real element. `tempCropRef` mirrors the state synchronously so the
  // commit effect below (and pointer-move handlers, which close over stale
  // state otherwise) always sees the latest value. `cropCancelledRef` is set
  // by the Escape handler; every OTHER way crop mode ends (Enter,
  // double-click, clicking away, selecting another element, navigating
  // pages, saving, etc. -- anything that flips `props.cropping` back to
  // false without Escape) is treated as a commit. This single rule is what
  // "commit on Enter/double-click/click-outside/exit, cancel on Escape"
  // reduces to once cropping is owned locally: the parent doesn't need to
  // know WHY it's exiting crop mode, only WHETHER Escape did it.
  const [tempCrop, setTempCropState] = useState<ImageCrop | undefined>(
    undefined,
  );
  const tempCropRef = useRef<ImageCrop | undefined>(undefined);
  const cropOriginalRef = useRef<ImageCrop | undefined>(undefined);
  const cropCancelledRef = useRef(false);
  const setTempCrop = (next: ImageCrop) => {
    tempCropRef.current = next;
    setTempCropState(next);
  };
  const wasCropping = useRef(false);
  useEffect(() => {
    if (props.cropping && element.type === "image") {
      if (!wasCropping.current) {
        const original = element.crop ?? DEFAULT_IMAGE_CROP;
        cropOriginalRef.current = original;
        cropCancelledRef.current = false;
        setTempCrop(original);
      }
      wasCropping.current = true;
      return;
    }
    if (wasCropping.current) {
      wasCropping.current = false;
      const original = cropOriginalRef.current;
      const edited = tempCropRef.current;
      if (
        !cropCancelledRef.current &&
        original &&
        edited &&
        (edited.x !== original.x ||
          edited.y !== original.y ||
          edited.zoom !== original.zoom)
      ) {
        onChange(element.id, { crop: edited } as Partial<ReportElement>);
      }
      tempCropRef.current = undefined;
      setTempCropState(undefined);
      cropOriginalRef.current = undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cropping]);

  useEffect(() => {
    if (!props.cropping || props.readOnly || element.type !== "image") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cropCancelledRef.current = true;
      } else if (event.key === "Enter") {
        event.preventDefault();
        props.onCommitCrop?.(element.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cropping, props.readOnly, element.type, element.id]);

  /** Snaps a crop pan percentage (0-100) to the frame edges, center, and
   * thirds -- the same "snap to notable positions" idea as position/rotation
   * snapping elsewhere, just against the crop's own fixed target set instead
   * of sibling geometry (a crop rectangle has no siblings to align to; its
   * only meaningful reference points are the source image's own edges/
   * center/thirds). Alt bypasses snapping, mirroring the rotation-snap
   * precedent (`snapRotation`'s `bypass: ev.altKey`) for a consistent
   * modifier-key story across every snapping interaction in the editor. */
  const snapCropPan = (value: number, bypass: boolean) => {
    if (bypass) return value;
    const targets = [0, 100 / 3, 50, (200 / 3), 100];
    const tolerance = 1.5;
    for (const target of targets)
      if (Math.abs(value - target) <= tolerance) return target;
    return value;
  };

  const startCropZoom = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.readOnly || element.type !== "image") return;
    props.onInteractionStart();
    const centerX = element.x + element.width / 2,
      centerY = element.y + element.height / 2;
    const canvas = (
      e.currentTarget.closest(".page-canvas") as HTMLElement
    ).getBoundingClientRect();
    const halfDiagonal = Math.max(
      1,
      Math.sqrt((element.width / 2) ** 2 + (element.height / 2) ** 2),
    );
    const move = (ev: PointerEvent) => {
      const px = (ev.clientX - canvas.left) / zoom,
        py = (ev.clientY - canvas.top) / zoom;
      const dist = Math.max(1, Math.hypot(px - centerX, py - centerY));
      let next = Math.max(1, Math.min(6, halfDiagonal / dist));
      if (!ev.altKey) {
        const targets = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
        const near = targets.find((t) => Math.abs(t - next) < 0.06);
        if (near != null) next = near;
      }
      const base = tempCropRef.current ?? element.crop ?? DEFAULT_IMAGE_CROP;
      setTempCrop({ ...base, zoom: Math.round(next * 1000) / 1000 });
    };
    const up = () => {
      props.onInteractionEnd();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startDrag = (e: React.PointerEvent) => {
    if (props.tableEditing && element.type === "table") return;
    if (element.locked) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!selected || additive) onSelect(element.id, additive);
    if (props.readOnly) return;
    props.onInteractionStart();
    const sx = e.clientX,
      sy = e.clientY,
      ox = element.x,
      oy = element.y;
    const movingIds =
      selected && selectedIds.length > 1
        ? new Set(selectedIds)
        : new Set([element.id]);
    const moving = elements.filter((item) => movingIds.has(item.id));
    const movingBounds = moving.reduce(
      (bounds, item) => {
        const box = getRotatedAabb(elementRect(item));
        return {
          minX: Math.min(bounds.minX, box.x),
          minY: Math.min(bounds.minY, box.y),
          maxX: Math.max(bounds.maxX, box.x + box.width),
          maxY: Math.max(bounds.maxY, box.y + box.height),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const crop =
      element.type === "image"
        ? (tempCropRef.current ?? element.crop ?? DEFAULT_IMAGE_CROP)
        : undefined;
    const move = (ev: PointerEvent) => {
      if (props.cropping && element.type === "image" && crop) {
        let x = Math.max(
          0,
          Math.min(
            100,
            crop.x + ((ev.clientX - sx) / zoom / element.width) * 100,
          ),
        );
        let y = Math.max(
          0,
          Math.min(
            100,
            crop.y + ((ev.clientY - sy) / zoom / element.height) * 100,
          ),
        );
        x = snapCropPan(x, ev.altKey);
        y = snapCropPan(y, ev.altKey);
        setTempCrop({ ...crop, x, y });
        return;
      }
      const result = snapPosition({
        x: movingBounds.minX + (ev.clientX - sx) / zoom,
        y: movingBounds.minY + (ev.clientY - sy) / zoom,
        width: movingBounds.maxX - movingBounds.minX,
        height: movingBounds.maxY - movingBounds.minY,
        rotation: 0,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        others: elements.filter((item) => !movingIds.has(item.id)),
        gridSpacing: settings.gridSpacingPx,
        snapGrid: settings.snapToGrid,
        snapElements: settings.snapToElements,
        margins: settings.snapToMargins ? settings.marginPx : undefined,
        customXTargets: (settings.customGuides ?? [])
          .filter((g) => g.axis === "x")
          .map((g) => g.position),
        customYTargets: (settings.customGuides ?? [])
          .filter((g) => g.axis === "y")
          .map((g) => g.position),
      });
      onGuides(result.guides);
      onChange(element.id, {
        x: ox + result.x - movingBounds.minX,
        y: oy + result.y - movingBounds.minY,
      } as Partial<ReportElement>);
    };
    const up = () => {
      onGuides([]);
      props.onInteractionEnd();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startCornerRadius = (e: React.PointerEvent, corner: CornerKey) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.readOnly) return;
    props.onInteractionStart();
    const sx = e.clientX;
    const sy = e.clientY;
    const initial = resolveCornerRadii(
      element.style,
      element.width,
      element.height,
    );
    const direction =
      corner === "topRight" || corner === "bottomRight" ? -1 : 1;
    const radians = (normalizeRotation(element.rotation) * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const move = (event: PointerEvent) => {
      const screenX = (event.clientX - sx) / zoom;
      const screenY = (event.clientY - sy) / zoom;
      const localX = cosine * screenX + sine * screenY;
      const value = initial[corner] + direction * localX;
      onChange(element.id, {
        style: {
          ...element.style,
          cornerRadii: updateCornerRadius(
            initial,
            corner,
            value,
            element.width,
            element.height,
          ),
        },
      } as Partial<ReportElement>);
    };
    const up = () => {
      props.onInteractionEnd();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (
    e: React.PointerEvent,
    corner: "se" | "sw" | "ne" | "nw",
  ) => {
    if (props.readOnly) return;
    if (element.locked) return;
    e.preventDefault();
    e.stopPropagation();
    props.onInteractionStart();
    const sx = e.clientX,
      sy = e.clientY,
      { x: ox, y: oy, width: ow, height: oh } = element;
    const radians = (normalizeRotation(element.rotation) * Math.PI) / 180;
    const cosine = Math.cos(radians),
      sine = Math.sin(radians);
    const xSign = corner.includes("e") ? 1 : -1,
      ySign = corner.includes("s") ? 1 : -1;
    const opposite = {
      x: ox + ow / 2 - (cosine * xSign * ow) / 2 + (sine * ySign * oh) / 2,
      y: oy + oh / 2 - (sine * xSign * ow) / 2 - (cosine * ySign * oh) / 2,
    };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom,
        dy = (ev.clientY - sy) / zoom;
      const localDx = cosine * dx + sine * dy,
        localDy = -sine * dx + cosine * dy;
      let width = Math.max(12, ow + xSign * localDx),
        height = Math.max(12, oh + ySign * localDy);
      if (ev.shiftKey) {
        const ratio = ow / oh;
        if (Math.abs(localDx) >= Math.abs(localDy)) height = width / ratio;
        else width = height * ratio;
      }
      const centerX =
        opposite.x + (cosine * xSign * width) / 2 - (sine * ySign * height) / 2;
      const centerY =
        opposite.y + (sine * xSign * width) / 2 + (cosine * ySign * height) / 2;
      const x = centerX - width / 2,
        y = centerY - height / 2;
      onChange(element.id, {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      } as Partial<ReportElement>);
    };
    const up = () => {
      props.onInteractionEnd();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startRotate = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.readOnly) return;
    props.onInteractionStart();
    const centerX = element.x + element.width / 2,
      centerY = element.y + element.height / 2;
    const canvas = (
      e.currentTarget.closest(".page-canvas") as HTMLElement
    ).getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const px = (ev.clientX - canvas.left) / zoom,
        py = (ev.clientY - canvas.top) / zoom;
      const rotation = snapRotation(
        (Math.atan2(py - centerY, px - centerX) * 180) / Math.PI + 90,
        { shiftKey: ev.shiftKey, bypass: ev.altKey },
      );
      const rounded = Math.round(rotation * 10) / 10;
      setRotationAngle(rounded);
      onChange(element.id, {
        rotation: rounded,
      } as Partial<ReportElement>);
    };
    const up = () => {
      setRotationAngle(null);
      props.onInteractionEnd();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const typography =
    element.type === "text"
      ? resolveTypography(element.style)
      : element.style.typography;
  const radii = resolveCornerRadii(
    element.style,
    element.width,
    element.height,
  );
  const isPath = element.type === "shape" && element.shape === "path";
  // A shape can be linked as another table's continuous header ribbon (see
  // engine/tableHeaderGroup.ts). Linking only overrides what the linking
  // table has actually configured — an unconfigured aspect falls back to
  // the shape's own independent styling, so linking never blanks it out.
  const linkedTable =
    element.type === "shape" ? findLinkedTable(element, elements) : undefined;
  const ribbonSide = linkedTable
    ? resolveHeaderGroup(linkedTable, elements)?.side
    : undefined;
  const ribbonOverride = ribbonSide
    ? ribbonGroupStyle(linkedTable!.headerBevel, linkedTable!.headerCornerRadius, ribbonSide)
    : undefined;
  const style: React.CSSProperties = {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    boxSizing: "border-box",
    opacity: element.style.opacity ?? 1,
    transform: `rotate(${normalizeRotation(element.rotation)}deg)`,
    transformOrigin: "center center",
    borderRadius:
      element.type === "shape" && element.shape === "circle"
        ? "50%"
        : (ribbonOverride?.borderRadius ?? cornerRadiiToCss(radii)),
    background: isPath
      ? "transparent"
      : fillToCss(element.style.fill, element.style.background),
    color: typography?.color ?? element.style.color,
    fontFamily: fontFamilyToCss(
      typography?.fontFamily ?? element.style.fontFamily,
      typography?.fontAssetId ?? element.style.fontAssetId,
    ),
    fontSize: typography?.fontSize ?? element.style.fontSize,
    fontWeight: typography?.fontWeight ?? element.style.fontWeight,
    fontStyle:
      typography?.fontStyle ??
      element.style.fontStyle ??
      (typography?.italic || element.style.italic ? "italic" : "normal"),
    fontSynthesis: "none",
    textDecoration: typography?.underline
      ? "underline"
      : element.style.textDecoration,
    textAlign:
      typography?.textAlign === "justify"
        ? "justify"
        : (typography?.textAlign ?? element.style.textAlign),
    letterSpacing: typography?.letterSpacing ?? element.style.letterSpacing,
    lineHeight: typography?.lineHeight ?? element.style.lineHeight,
    padding: element.style.padding,
    mixBlendMode: element.style.mixBlendMode,
    textShadow:
      element.type === "text"
        ? dropShadowToCss(element.style.shadow)
        : undefined,
    boxShadow:
      element.type === "shape" || element.type === "image" || element.type === "table"
        ? isPath
          ? undefined
          : (ribbonOverride?.boxShadow ??
            elementBoxShadowToCss(
              element.style.shadow,
              element.type === "shape" ? element.style.bevel : undefined,
            ))
        : undefined,
    cursor: element.locked ? "not-allowed" : "move",
    ...strokeStyle(element),
  };
  if (isPath) {
    style.border = 0;
  }
  if (element.type === "shape" && element.shape === "triangle")
    style.clipPath = "polygon(50% 0, 100% 100%, 0 100%)";
  if (element.type === "shape" && element.shape === "diamond")
    style.clipPath = "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)";
  if (element.type === "shape" && element.shape === "line") {
    style.height = Math.max(2, element.style.stroke?.width ?? 2);
    style.background =
      element.style.stroke?.color ?? element.style.background ?? "#111827";
    style.border = 0;
  }

  let content: React.ReactNode = null;
  if (isPath) {
    const path = shapePathToSvg(element as ShapeElement);
    const fill = element.style.fill;
    const gradientId = `union-gradient-${element.id}`;
    const shadowFilterId = `union-shadow-${element.id}`;
    const bevel = resolveBevel(element.style.bevel);
    // Print-safe shadow for custom/union path shapes (report banners built
    // with the freeform shape tool, e.g. a ribbon or wave-edged header).
    // A CSS `filter: drop-shadow()` on the <svg> box forces the browser to
    // isolate the whole element into an offscreen compositing/transparency
    // group; Chromium's "Print to PDF" pipeline flattens that group against
    // an opaque backdrop instead of preserving transparency, which paints
    // as a solid white rectangle behind the shape in the exported PDF even
    // though the on-screen (non-printed) render composites correctly.
    // Rectangle/other shapes never hit this because they use the CSS
    // `box-shadow` property (see elementBoxShadowToCss below), which is
    // painted directly rather than requiring a filter compositing pass —
    // that is the entire dynamic-vs-static print difference.
    //
    // The fix below stays inside the SVG's own raster/alpha model instead:
    // an <feOffset>/<feGaussianBlur>/<feFlood>/<feComposite> recipe applied
    // only to a dedicated shadow <path> (not the whole <svg>), producing an
    // explicit shadow layer. This avoids the whole-SVG CSS filter
    // compositing group that caused the observed white-block artifact —
    // it is not a general guarantee against every possible print/PDF
    // rendering quirk, just against that specific mechanism.
    const shadow = resolveDropShadow(element.style.shadow);
    const shadowPad = shadow.enabled
      ? Math.max(0, shadow.blur) * 2 +
        Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY)) +
        4
      : 0;
    content = (
      <svg
        className="shape-path-svg"
        viewBox={`0 0 ${element.width} ${element.height}`}
        preserveAspectRatio="none"
      >
        <defs>
          {fill?.type === "linear-gradient" && (
            <linearGradient
              id={gradientId}
              gradientTransform={`rotate(${fill.angle} .5 .5)`}
            >
              {fill.stops.map((stop) => (
                <stop
                  key={stop.id}
                  offset={`${stop.position}%`}
                  stopColor={stop.color}
                />
              ))}
            </linearGradient>
          )}
          {shadow.enabled && (
            <filter
              id={shadowFilterId}
              x={-shadowPad}
              y={-shadowPad}
              width={element.width + shadowPad * 2}
              height={element.height + shadowPad * 2}
              filterUnits="userSpaceOnUse"
            >
              <feOffset
                in="SourceAlpha"
                dx={shadow.offsetX}
                dy={shadow.offsetY}
                result="offset"
              />
              <feGaussianBlur
                in="offset"
                stdDeviation={Math.max(0, shadow.blur) / 2}
                result="blurred"
              />
              <feFlood
                floodColor={shadow.color}
                floodOpacity={Math.max(0, Math.min(1, shadow.opacity))}
                result="color"
              />
              <feComposite in="color" in2="blurred" operator="in" />
            </filter>
          )}
        </defs>
        {shadow.enabled && (
          <path d={path} fill="#000" filter={`url(#${shadowFilterId})`} />
        )}
        {bevel.enabled && (
          <path
            d={path}
            fill="none"
            stroke={
              bevel.direction === "raised"
                ? bevel.highlightColor
                : bevel.shadowColor
            }
            strokeOpacity={
              bevel.direction === "raised"
                ? bevel.highlightOpacity
                : bevel.shadowOpacity
            }
            strokeWidth={bevel.size}
          />
        )}
        <path
          d={path}
          fill={
            fill?.type === "linear-gradient"
              ? `url(#${gradientId})`
              : (fill?.color ?? element.style.background ?? "transparent")
          }
          fillRule="evenodd"
          stroke={
            element.style.stroke?.enabled ? element.style.stroke.color : "none"
          }
          strokeOpacity={element.style.stroke?.opacity}
          strokeWidth={element.style.stroke?.width}
          strokeDasharray={
            element.style.stroke?.style === "dashed"
              ? "6 4"
              : element.style.stroke?.style === "dotted"
                ? "1 3"
                : undefined
          }
        />
      </svg>
    );
  } else if (element.type === "text") {
    const cardState =
      mode === "data" &&
      element.binding &&
      /\.(address|detail)$/.test(element.binding.path)
        ? getByContextPath(
            data,
            element.binding.path.replace(/\.(address|detail)$/, ".state"),
            element.bindingContext,
          )
        : undefined;
    const manualOverride = element.binding
      ? props.manualOverrides?.find(
          (item) =>
            item.elementId === element.id &&
            item.bindingPath === element.binding?.path,
        )
      : undefined;
    const raw =
      cardState === "none"
        ? ""
        : mode === "data" && manualOverride
          ? String(manualOverride.overrideValue ?? "")
          : mode === "data" && element.binding
            ? formatValue(
                getByContextPath(
                  data,
                  element.binding.path,
                  element.bindingContext,
                ),
                element.binding,
              )
            : element.text;
    content = (
      <div
        className={`text-content ${verticalAlignmentClass(typography?.verticalAlign ?? "top")}`}
      >
        <span className="text-value">
          {typography?.uppercase ? raw.toUpperCase() : raw}
        </span>
      </div>
    );
  } else if (element.type === "image") {
    const dynamic =
      mode === "data" && element.binding
        ? getByContextPath(data, element.binding.path, element.bindingContext)
        : undefined;
    const src = typeof dynamic === "string" ? dynamic : element.src,
      recordState =
        mode === "data" && element.binding?.path.endsWith(".image")
          ? getByContextPath(
              data,
              element.binding.path.replace(/\.image$/, ".state"),
              element.bindingContext,
            )
          : undefined,
      objectFit =
        element.fit === "stretch"
          ? "fill"
          : element.fit === "original"
            ? "none"
            : (element.fit ?? "cover");
    const crop =
      props.cropping && !props.readOnly && tempCrop
        ? tempCrop
        : (element.crop ?? DEFAULT_IMAGE_CROP);
    const region = element.sourceCrop;
    content =
      recordState === "none" ? (
        <div className="property-card-placeholder none-to-report">
          None to Report
        </div>
      ) : src ? (
        <img
          src={src}
          alt={element.name}
          style={
            region
              ? {
                  position: "absolute",
                  width: (element.width * region.sourceWidth) / region.width,
                  height:
                    (element.height * region.sourceHeight) / region.height,
                  left: (-region.x * element.width) / region.width,
                  top: (-region.y * element.height) / region.height,
                  maxWidth: "none",
                  pointerEvents: "none",
                  clipPath: element.edgeInset
                    ? `inset(${element.edgeInset}px)`
                    : undefined,
                }
              : {
                  width: `${crop.zoom * 100}%`,
                  height: `${crop.zoom * 100}%`,
                  objectFit,
                  objectPosition: `${crop.x}% ${crop.y}%`,
                  transform: `translate(${((1 - crop.zoom) * crop.x) / crop.zoom}%,${((1 - crop.zoom) * crop.y) / crop.zoom}%)`,
                  pointerEvents: "none",
                  maxWidth: "none",
                  clipPath: element.edgeInset
                    ? `inset(${element.edgeInset}px)`
                    : undefined,
                }
          }
        />
      ) : (
        <div className="property-card-placeholder image-unavailable">
          Image unavailable
        </div>
      );
  } else if (element.type === "table") {
    const rows = getByContextPath(
        data,
        element.sourcePath,
        element.bindingContext,
      ),
      arr = Array.isArray(rows)
        ? rows.slice(0, element.maxRows ?? rows.length)
        : [];
    const tableCellContent = (
      row: unknown,
      column: (typeof element.columns)[number],
    ) => {
      const formatted = formatValue(getByPath(row, column.path), {
        path: column.path,
        format: column.format,
        decimals: column.decimals ?? 1,
      });
      if (element.variant === "indicators" && column.path === "metric") {
        const direction = String(getByPath(row, "direction") ?? "equal");
        const semanticStatus = String(
          getByPath(row, "semanticStatus") ?? "neutral",
        );
        const indicatorKind = String(
          getByPath(row, "indicatorKind") ??
            (direction === "equal" ? "bar" : "arrow"),
        );
        return (
          <span
            className="metric-direction-label"
            aria-label={`${formatted}: ${indicatorKind === "bar" ? "neutral" : direction}, ${semanticStatus}`}
          >
            <span
              aria-hidden="true"
              className={`metric-direction-indicator kind-${indicatorKind} status-${semanticStatus}`}
              data-direction={direction}
              data-indicator-kind={indicatorKind}
              data-semantic-status={semanticStatus}
              style={{
                color: String(getByPath(row, "indicatorColor") ?? "#4E131E"),
              }}
            >
              {indicatorKind === "bar" ? (
                <span className="metric-neutral-bar" />
              ) : (
                String(getByPath(row, "indicatorGlyph") ?? "")
              )}
            </span>
            <span>{formatted}</span>
          </span>
        );
      }
      if (element.variant === "market-matrix" && column.path === "name") {
        const geographyId = String(getByPath(row, "geographyId") ?? "").trim();
        const target =
          geographyId && props.pages
            ? resolveOverviewPageTarget(props.pages, geographyId)
            : undefined;
        if (target?.anchor)
          return (
            <a
              href={`#${target.anchor}`}
              className="report-internal-link"
              aria-label={`Go to ${formatted} Market Overview`}
              data-page-target={target.id}
              data-page-anchor={target.anchor}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={
                props.onNavigatePage
                  ? (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      props.onNavigatePage?.(target.id);
                    }
                  : undefined
              }
            >
              {formatted}
            </a>
          );
      }
      return formatted;
    };
    const headerGroup = resolveHeaderGroup(element, elements);
    const headerBevelShadow = headerCellBoxShadow(element.headerBevel);
    const headerRowShadow = directionalDropShadowToCss(element.headerRowShadow);
    const headerBoxShadow =
      [headerBevelShadow, headerRowShadow].filter(Boolean).join(", ") ||
      undefined;
    const rowShadowFor = (rowKind: string | undefined, rowIndex: number) => {
      const shadow =
        (rowKind ? element.rowKindShadows?.[rowKind] : undefined) ??
        element.bodyRowShadows?.[String(rowIndex)];
      return directionalDropShadowToCss(shadow);
    };
    const isHeaderRowSelected =
      props.tableSelection?.section === "row" &&
      props.tableSelection.row == null;
    const isBodyRowSelected = (rowIndex: number) =>
      props.tableSelection?.section === "row" &&
      props.tableSelection.row === rowIndex;
    // See docs/table-appearance-controls: `.report-table` (and every th/td)
    // paints an opaque background, so when `headerCornerRadius` rounds a
    // header <th>'s corners, the RECTANGULAR area outside that curve but
    // still inside the cell's bounding box shows the table's own white
    // background through the "cut" corner instead of nothing. Wrapping the
    // table in a container clipped to the SAME top-corner radii, and making
    // the table's own background transparent (the wrapper supplies the
    // white background instead), removes that leftover rectangle without
    // touching `.report-table`'s background for tables that don't round
    // their header at all -- this wrapper is only rendered when
    // `headerCornerRadius` is actually set, so the unrounded default path
    // (background on `<table>` itself, no wrapper) is completely unchanged.
    const headerWrapperRadii = headerWrapperCornerRadii(
      element.headerCornerRadius,
      headerGroup,
    );
    const table = (
      <table
        className={`report-table table-${element.variant ?? "default"}`}
        style={headerWrapperRadii ? { background: "transparent" } : undefined}
      >
        <colgroup>
          {element.columns.map((c) => (
            <col
              key={c.key}
              style={c.width ? { width: `${c.width}%` } : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr className={isHeaderRowSelected ? "table-row-selected" : undefined}>
            {element.columns.map((c, column) => (
              <th
                key={c.key}
                data-table-section="header"
                data-table-column={column}
                className={
                  props.tableSelection?.section === "header" &&
                  props.tableSelection.column === column
                    ? "table-cell-selected"
                    : props.tableSelection?.section === "column" &&
                        props.tableSelection.column === column
                      ? "table-column-selected"
                      : undefined
                }
                style={{
                  ...tableStyle(
                    mergeCellStyle(element.headerStyle, c.headerStyle),
                    resolveCellBackdrop(element.variant, "header", undefined, 0),
                  ),
                  textAlign: c.align,
                  boxShadow: headerBoxShadow,
                  borderRadius: headerCellCornerRadius(
                    element.headerCornerRadius,
                    { isFirst: column === 0, isLast: column === element.columns.length - 1 },
                    headerGroup,
                  ),
                }}
                onPointerDown={
                  props.tableEditing
                    ? (event) => {
                        event.stopPropagation();
                        props.onTableSelect?.({ section: "header", column });
                      }
                    : undefined
                }
                onClick={
                  props.tableEditing
                    ? (event) => event.stopPropagation()
                    : undefined
                }
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {arr.length === 0 ? (
            <tr className="row-empty">
              <td colSpan={element.columns.length}>
                {element.emptyMessage ??
                  "Data unavailable from selected source"}
              </td>
            </tr>
          ) : (
            arr.map((row, i) => {
              const rowKind = element.rowKindPath
                ? String(getByPath(row, element.rowKindPath))
                : undefined;
              const rowShadow = rowShadowFor(rowKind, i);
              return (
              <tr
                key={i}
                className={[
                  rowKind ? `row-${rowKind}` : undefined,
                  isBodyRowSelected(i) ? "table-row-selected" : undefined,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined}
              >
                {element.columns.map((c, column) => (
                  <td
                    key={c.key}
                    data-table-section="body"
                    data-table-row={i}
                    data-table-column={column}
                    className={
                      props.tableSelection?.section === "body" &&
                      props.tableSelection.row === i &&
                      props.tableSelection.column === column
                        ? "table-cell-selected"
                        : props.tableSelection?.section === "column" &&
                            props.tableSelection.column === column
                          ? "table-column-selected"
                          : undefined
                    }
                    style={{
                      ...tableStyle(
                        mergeCellStyle(
                          element.bodyStyle,
                          c.bodyStyle,
                          rowKind === "total" ? element.totalStyle : undefined,
                          element.cellStyles?.[`body:${i}:${column}`],
                        ),
                        resolveCellBackdrop(element.variant, "body", rowKind, i),
                      ),
                      textAlign: c.align,
                      height: element.rowHeight,
                      boxShadow: rowShadow,
                    }}
                    onPointerDown={
                      props.tableEditing
                        ? (event) => {
                            event.stopPropagation();
                            props.onTableSelect?.({
                              section: "body",
                              row: i,
                              column,
                            });
                          }
                        : undefined
                    }
                    onClick={
                      props.tableEditing
                        ? (event) => event.stopPropagation()
                        : undefined
                    }
                  >
                    {element.variant === "transactions" && c.path === "type" ? (
                      <div className="transaction-type-cell">
                        <span className="transaction-type-value">
                          {formatValue(getByPath(row, c.path), {
                            path: c.path,
                            format: c.format,
                            decimals: c.decimals ?? 1,
                          })}
                        </span>
                        {getByPath(row, "isLeeDeal") === true && (
                          <span
                            className="lee-deal-chip"
                            data-testid="lee-deal-chip"
                            data-font-asset-id={
                              element.transactionChipStyle?.fontAssetId
                            }
                            data-font-checksum={
                              element.transactionChipStyle?.fontChecksum
                            }
                            style={{
                              ...tableStyle(element.transactionChipStyle),
                              fontSynthesis: "none",
                            }}
                          >
                            LEE DEAL
                          </span>
                        )}
                      </div>
                    ) : (
                      tableCellContent(row, c)
                    )}
                  </td>
                ))}
              </tr>
              );
            })
          )}
        </tbody>
      </table>
    );
    content = headerWrapperRadii ? (
      <div
        className="table-header-clip"
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "#fff",
          borderRadius: `${headerWrapperRadii.topLeft}px ${headerWrapperRadii.topRight}px 0 0`,
        }}
      >
        {table}
      </div>
    ) : (
      table
    );
  } else if (element.type === "chart") {
    content = <NativeChart element={element} data={data} />;
  }
  if (element.hidden) return null;
  const narrativeMarketId =
    element.type === "text" &&
    element.binding?.path === "overallMarket.narrative"
      ? "overall-market"
      : element.type === "text" && element.binding?.path === "market.narrative"
        ? String(
            getByContextPath(data, "market.id", element.bindingContext) ??
              getByContextPath(data, "market.name", element.bindingContext) ??
              "submarket",
          )
        : undefined;
  return (
    <div
      data-testid={element.id}
      data-narrative-id={narrativeMarketId}
      className={`canvas-element ${selected ? "is-selected" : ""} ${props.cropping ? "is-cropping" : ""} ${props.tableEditing ? "is-table-editing" : ""}`}
      style={style}
      onPointerDown={startDrag}
      onClick={(event) => {
        event.stopPropagation();
        // Pointer selection is handled on pointerdown so drag can begin
        // immediately. Keep zero-detail clicks for keyboard/programmatic
        // activation without toggling a real Shift-click twice.
        if (event.detail === 0)
          onSelect(
            element.id,
            event.shiftKey || event.metaKey || event.ctrlKey,
          );
      }}
      onDoubleClick={(event) => {
        if (element.type === "table" && selected) {
          event.stopPropagation();
          props.onEnterTableEdit?.(element.id);
        } else if (
          element.type === "image" &&
          props.cropping &&
          !props.readOnly
        ) {
          event.stopPropagation();
          props.onCommitCrop?.(element.id);
        }
      }}
      onContextMenu={(e) => props.onContextMenu(e, element.id)}
    >
      <div
        className="element-content-clip"
        data-image-clip={element.type === "image" ? "true" : undefined}
      >
        {content}
      </div>
      {selected && <div className="selection-outline" />}
      {props.cropping &&
        !props.readOnly &&
        element.type === "image" &&
        !element.sourceCrop && (
          <>
            {/* Removed-area darkening + crop boundary: a "window" the size of
                the frame, with a huge box-shadow spread standing in for an
                infinite dark mask everywhere OUTSIDE it. The retained region
                (the window's own transparent center, exactly the frame) stays
                at normal brightness since nothing paints over it. */}
            <div
              className="crop-window"
              data-testid="crop-window"
              style={{
                boxShadow: `0 0 0 ${Math.max(600, element.width, element.height) * 2}px rgba(15, 45, 79, 0.55)`,
              }}
            >
              <span className="crop-third crop-third-v" style={{ left: "33.333%" }} />
              <span className="crop-third crop-third-v" style={{ left: "66.667%" }} />
              <span className="crop-third crop-third-h" style={{ top: "33.333%" }} />
              <span className="crop-third crop-third-h" style={{ top: "66.667%" }} />
            </div>
            {(["nw", "ne", "sw", "se"] as const).map((corner) => (
              <button
                key={corner}
                className={`crop-zoom-handle handle-${corner}`}
                aria-label={`Crop zoom ${corner}`}
                title="Drag to zoom the crop; drag the image to pan. Alt disables snapping."
                onPointerDown={startCropZoom}
              />
            ))}
          </>
        )}
      {selected && !element.locked && !props.readOnly && (
        <>
          {(["nw", "ne", "sw", "se"] as const).map((corner) => (
            <div
              key={corner}
              className={`resize-handle handle-${corner}`}
              onPointerDown={(e) => startResize(e, corner)}
            />
          ))}
          <div className="rotation-stem" />
          <button
            className="rotation-handle"
            aria-label="Rotate element"
            onPointerDown={startRotate}
          />
          {rotationAngle != null && (
            <div className="rotation-tooltip" data-testid="rotation-tooltip">
              {Math.round(rotationAngle)}°
            </div>
          )}
        </>
      )}
      {selected &&
        !element.locked &&
        !props.readOnly &&
        !props.cropping &&
        (element.type === "image" ||
          (element.type === "shape" &&
            ![
              "circle",
              "ellipse",
              "line",
              "triangle",
              "diamond",
              "path",
            ].includes(element.shape ?? "rectangle"))) &&
        (
          ["topLeft", "topRight", "bottomRight", "bottomLeft"] as CornerKey[]
        ).map((corner) => (
          <button
            key={corner}
            className={`corner-radius-handle radius-${corner}`}
            aria-label={`${corner} corner radius`}
            title={`${corner} radius: ${Math.round(radii[corner])}px`}
            style={{
              [corner === "topLeft" || corner === "bottomLeft"
                ? "left"
                : "right"]: Math.max(4, radii[corner] - 5),
              [corner === "topLeft" || corner === "topRight"
                ? "top"
                : "bottom"]: -5,
            }}
            onPointerDown={(event) => startCornerRadius(event, corner)}
          />
        ))}
      {selected && (
        <div className="element-badge">
          {element.name}
          {element.locked ? " · Locked" : ""}
        </div>
      )}
    </div>
  );
}
