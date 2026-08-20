import React from "react";
import type {
  EditorSettings,
  PreviewMode,
  ReportElement,
} from "../types/report";
import type { SnapGuide } from "../engine/editorMath";
import { fillToCss, snapPosition } from "../engine/editorMath";
import { formatValue, getByContextPath, getByPath } from "../engine/bindings";
import { NativeChart } from "../report-engine/charts/NativeChart";
import { normalizeRotation, snapRotation } from "../engine/geometry";
import {
  resolveTypography,
  verticalAlignmentClass,
} from "../engine/typography";

interface Props {
  element: ReportElement;
  elements: ReportElement[];
  pageSize: { width: number; height: number };
  settings: EditorSettings;
  data: unknown;
  mode: PreviewMode;
  selected: boolean;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (id: string, patch: Partial<ReportElement>) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onGuides: (guides: SnapGuide[]) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  cropping?: boolean;
}

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
    zoom,
    onSelect,
    onChange,
    onGuides,
  } = props;
  const startDrag = (e: React.PointerEvent) => {
    if (element.locked) return;
    e.stopPropagation();
    onSelect(element.id, e.shiftKey || e.metaKey || e.ctrlKey);
    props.onInteractionStart();
    const sx = e.clientX,
      sy = e.clientY,
      ox = element.x,
      oy = element.y;
    const crop =
      element.type === "image"
        ? (element.crop ?? { x: 50, y: 50, zoom: 1 })
        : undefined;
    const move = (ev: PointerEvent) => {
      if (props.cropping && element.type === "image" && crop) {
        const x = Math.max(
          0,
          Math.min(
            100,
            crop.x + ((ev.clientX - sx) / zoom / element.width) * 100,
          ),
        );
        const y = Math.max(
          0,
          Math.min(
            100,
            crop.y + ((ev.clientY - sy) / zoom / element.height) * 100,
          ),
        );
        onChange(element.id, {
          crop: { ...crop, x, y },
        } as Partial<ReportElement>);
        return;
      }
      const result = snapPosition({
        x: ox + (ev.clientX - sx) / zoom,
        y: oy + (ev.clientY - sy) / zoom,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        others: elements.filter((item) => item.id !== element.id),
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
        x: result.x,
        y: result.y,
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

  const startResize = (
    e: React.PointerEvent,
    corner: "se" | "sw" | "ne" | "nw",
  ) => {
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
      onChange(element.id, {
        rotation: Math.round(rotation * 10) / 10,
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

  const typography =
    element.type === "text"
      ? resolveTypography(element.style)
      : element.style.typography;
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
        : (element.style.borderRadius ?? 0),
    background: fillToCss(element.style.fill, element.style.background),
    color: typography?.color ?? element.style.color,
    fontFamily: typography?.fontFamily ?? element.style.fontFamily,
    fontSize: typography?.fontSize ?? element.style.fontSize,
    fontWeight: typography?.fontWeight ?? element.style.fontWeight,
    fontStyle:
      typography?.fontStyle ??
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
    overflow: "hidden",
    mixBlendMode: element.style.mixBlendMode,
    cursor: element.locked ? "not-allowed" : "move",
    ...strokeStyle(element),
  };
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
  if (element.type === "text") {
    const raw =
      mode === "data" && element.binding
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
        {typography?.uppercase ? raw.toUpperCase() : raw}
      </div>
    );
  } else if (element.type === "image") {
    const dynamic =
      mode === "data" && element.binding
        ? getByContextPath(data, element.binding.path, element.bindingContext)
        : undefined;
    const src = typeof dynamic === "string" ? dynamic : element.src,
      objectFit =
        element.fit === "stretch"
          ? "fill"
          : element.fit === "original"
            ? "none"
            : (element.fit ?? "cover");
    const crop = element.crop ?? { x: 50, y: 50, zoom: 1 };
    const region = element.sourceCrop;
    content = src ? (
      <img
        src={src}
        alt={element.name}
        style={
          region
            ? {
                position: "absolute",
                width: (element.width * region.sourceWidth) / region.width,
                height: (element.height * region.sourceHeight) / region.height,
                left: (-region.x * element.width) / region.width,
                top: (-region.y * element.height) / region.height,
                maxWidth: "none",
                pointerEvents: "none",
              }
            : {
                width: `${crop.zoom * 100}%`,
                height: `${crop.zoom * 100}%`,
                objectFit,
                objectPosition: `${crop.x}% ${crop.y}%`,
                transform: `translate(${((1 - crop.zoom) * crop.x) / crop.zoom}%,${((1 - crop.zoom) * crop.y) / crop.zoom}%)`,
                pointerEvents: "none",
                maxWidth: "none",
              }
        }
      />
    ) : (
      <div className="image-placeholder">Image</div>
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
    content = (
      <table className={`report-table table-${element.variant ?? "default"}`}>
        <colgroup>
          {element.columns.map((c) => (
            <col
              key={c.key}
              style={c.width ? { width: `${c.width}%` } : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {element.columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align }}>
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
            arr.map((row, i) => (
              <tr
                key={i}
                className={
                  element.rowKindPath
                    ? `row-${String(getByPath(row, element.rowKindPath))}`
                    : undefined
                }
              >
                {element.columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align }}>
                    {formatValue(getByPath(row, c.path), {
                      path: c.path,
                      format: c.format,
                      decimals: c.decimals ?? 1,
                    })}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    );
  } else if (element.type === "chart") {
    content = <NativeChart element={element} data={data} />;
  }
  if (element.hidden) return null;
  return (
    <div
      data-testid={element.id}
      className={`canvas-element ${selected ? "is-selected" : ""} ${props.cropping ? "is-cropping" : ""}`}
      style={style}
      onPointerDown={startDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(element.id, e.shiftKey || e.metaKey || e.ctrlKey);
      }}
      onContextMenu={(e) => props.onContextMenu(e, element.id)}
    >
      {content}
      {selected && <div className="selection-outline" />}
      {props.cropping && (
        <div className="crop-overlay">
          <span>Drag image to reposition</span>
        </div>
      )}
      {selected && !element.locked && (
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
        </>
      )}
      {selected && (
        <div className="element-badge">
          {element.name}
          {element.locked ? " · Locked" : ""}
        </div>
      )}
    </div>
  );
}
