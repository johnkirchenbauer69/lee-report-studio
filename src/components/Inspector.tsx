import type {
  Asset,
  BevelStyle,
  DropShadow,
  Fill,
  ReportElement,
  ShapeElement,
  Stroke,
  TableCellStyle,
  TableElement,
  TableSelection,
  Typography,
  Unit,
} from "../types/report";
import { resolveBevel, resolveDropShadow } from "../engine/effects";
import {
  resolveCornerRadii,
  updateCornerRadius,
  type CornerKey,
} from "../engine/corners";
import { formatUnit, toPixels, unitStep } from "../engine/editorMath";
import { normalizeRotation } from "../engine/geometry";
import {
  BUILTIN_FONT_FAMILIES,
  BRAND_FONT_FAMILY,
  diagnoseFontSelection,
  groupFontAssets,
  normalizeSemanticFontFamily,
  resolveAvailableManagedFontFace,
  type ManagedFontFaceDiagnostic,
} from "../services/fontRegistry";
import { resolveTypography, withTypography } from "../engine/typography";
import {
  formatValue,
  getByContextPath,
  resolveContextPath,
} from "../engine/bindings";
import type { IndustrialMarketReport } from "../report-engine/schema/industrialMarketReport";
import {
  findPresentationOverride,
  findProvenance,
} from "../report-engine/provenance/provenance";

interface Props {
  element?: ReportElement;
  unit: Unit;
  selectionCount: number;
  fontAssets?: Asset[];
  fontDiagnostics?: ManagedFontFaceDiagnostic[];
  onChange: (patch: Partial<ReportElement>) => void;
  onAlign: (
    value: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) => void;
  onDistribute: (axis: "x" | "y") => void;
  canUnion?: boolean;
  unionReason?: string;
  onUnion?: () => void;
  cropping?: boolean;
  onToggleCrop?: () => void;
  onReplaceImage?: () => void;
  data?: unknown;
  report?: IndustrialMarketReport;
  tableEditing?: boolean;
  tableSelection?: TableSelection;
  generated?: boolean;
  readOnly?: boolean;
  onToggleTableEdit?: () => void;
  onTableSelectionChange?: (selection: TableSelection | undefined) => void;
  /** Sibling elements on the same page, used to list side-ribbon link candidates. */
  pageElements?: ReportElement[];
}

function Section({
  title,
  children,
  open = true,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="inspector-section" open={open}>
      <summary>
        {title}
        <span>⌄</span>
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function ColorField({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowNone?: boolean;
}) {
  return (
    <label>
      {label}
      <div className="color-field">
        <input
          aria-label={`${label} picker`}
          type="color"
          value={value === "transparent" ? "#ffffff" : value}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
        <input value={value} onChange={(e) => onChange(e.target.value)} />
        {allowNone && (
          <button
            type="button"
            title="No fill"
            onClick={() => onChange("transparent")}
          >
            ∅
          </button>
        )}
      </div>
    </label>
  );
}

/**
 * The enabled/color/offset/blur/opacity control set shared by every drop
 * shadow in the app (element drop shadow, table container shadow, and the
 * per-region table text shadows). `toggleLabel` names the on/off checkbox;
 * `fieldPrefix` names the sub-fields ("Shadow" for the existing generic
 * Drop Shadow section, a more specific prefix wherever more than one shadow
 * control can be visible at once so aria-labels stay unique).
 */
function ShadowFields({
  toggleLabel,
  fieldPrefix = "Shadow",
  shadow,
  onChange,
}: {
  toggleLabel: string;
  fieldPrefix?: string;
  shadow: DropShadow;
  onChange: (patch: Partial<DropShadow>) => void;
}) {
  return (
    <>
      <label className="toggle-row">
        <input
          aria-label={toggleLabel}
          type="checkbox"
          checked={shadow.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        <span>{shadow.enabled ? "On" : "Off"}</span>
      </label>
      {shadow.enabled && (
        <>
          <ColorField
            label={`${fieldPrefix} color`}
            value={shadow.color}
            onChange={(color) => onChange({ color })}
          />
          <div className="field-grid">
            <label>
              X Offset <span>px</span>
              <input
                aria-label={`${fieldPrefix} X Offset`}
                type="number"
                step=".5"
                value={shadow.offsetX}
                onChange={(event) =>
                  onChange({ offsetX: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Y Offset <span>px</span>
              <input
                aria-label={`${fieldPrefix} Y Offset`}
                type="number"
                step=".5"
                value={shadow.offsetY}
                onChange={(event) =>
                  onChange({ offsetY: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <div className="field-grid">
            <label>
              Blur <span>px</span>
              <input
                aria-label={`${fieldPrefix} Blur`}
                type="number"
                min="0"
                step=".5"
                value={shadow.blur}
                onChange={(event) =>
                  onChange({ blur: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Opacity <span>%</span>
              <input
                aria-label={`${fieldPrefix} Opacity`}
                type="number"
                min="0"
                max="100"
                value={Math.round(shadow.opacity * 100)}
                onChange={(event) =>
                  onChange({
                    opacity: Math.max(
                      0,
                      Math.min(1, Number(event.target.value) / 100),
                    ),
                  })
                }
              />
            </label>
          </div>
        </>
      )}
    </>
  );
}

/** The enabled/size/direction/highlight/shadow control set shared by every bevel. */
function BevelFields({
  toggleLabel = "Bevel",
  bevel,
  onChange,
}: {
  toggleLabel?: string;
  bevel: BevelStyle;
  onChange: (patch: Partial<BevelStyle>) => void;
}) {
  return (
    <>
      <label className="toggle-row">
        <input
          aria-label={toggleLabel}
          type="checkbox"
          checked={bevel.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        <span>{bevel.enabled ? "On" : "Off"}</span>
      </label>
      {bevel.enabled && (
        <>
          <div className="field-grid">
            <label>
              Size <span>px</span>
              <input
                aria-label="Bevel size"
                type="number"
                min="0"
                value={bevel.size}
                onChange={(event) =>
                  onChange({ size: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Direction
              <select
                aria-label="Bevel direction"
                value={bevel.direction}
                onChange={(event) =>
                  onChange({
                    direction: event.target.value as BevelStyle["direction"],
                  })
                }
              >
                <option value="raised">Raised</option>
                <option value="inset">Inset</option>
              </select>
            </label>
          </div>
          <ColorField
            label="Highlight"
            value={bevel.highlightColor}
            onChange={(highlightColor) => onChange({ highlightColor })}
          />
          <label>
            Highlight opacity <span>%</span>
            <input
              aria-label="Bevel highlight opacity"
              type="number"
              min="0"
              max="100"
              value={Math.round(bevel.highlightOpacity * 100)}
              onChange={(event) =>
                onChange({
                  highlightOpacity: Number(event.target.value) / 100,
                })
              }
            />
          </label>
          <ColorField
            label="Shadow"
            value={bevel.shadowColor}
            onChange={(shadowColor) => onChange({ shadowColor })}
          />
          <label>
            Shadow opacity <span>%</span>
            <input
              aria-label="Bevel shadow opacity"
              type="number"
              min="0"
              max="100"
              value={Math.round(bevel.shadowOpacity * 100)}
              onChange={(event) =>
                onChange({ shadowOpacity: Number(event.target.value) / 100 })
              }
            />
          </label>
        </>
      )}
    </>
  );
}

const strokeDefaults: Stroke = {
  enabled: false,
  color: "#111827",
  width: 1,
  opacity: 1,
  style: "solid",
};

export function Inspector({
  element,
  unit,
  selectionCount,
  fontAssets = [],
  fontDiagnostics = [],
  cropping,
  onToggleCrop,
  onReplaceImage,
  onChange,
  onAlign,
  onDistribute,
  canUnion,
  unionReason,
  onUnion,
  data,
  report,
  tableEditing,
  tableSelection,
  generated,
  readOnly = false,
  onToggleTableEdit,
  onTableSelectionChange,
  pageElements = [],
}: Props) {
  if (!element)
    return (
      <aside className="inspector" inert={readOnly ? true : undefined}>
        <div className="inspector-header">
          <strong>Inspector</strong>
        </div>
        <div className="empty-state inspector-empty">
          <div className="empty-icon">◇</div>
          <strong>Nothing selected</strong>
          <span>Select an element on the canvas to edit its properties.</span>
        </div>
      </aside>
    );
  if (selectionCount > 1)
    return (
      <aside className="inspector" inert={readOnly ? true : undefined}>
        <div className="inspector-header">
          <div>
            <strong>{selectionCount} elements</strong>
            <span>Multi-selection</span>
          </div>
          <span className="type-chip">multi</span>
        </div>
        <Section title="Arrange">
          <span className="control-label">Align selected boxes</span>
          <div className="icon-grid six" aria-label="Box alignment controls">
            {(
              [
                ["left", "⇤"],
                ["center", "↔"],
                ["right", "⇥"],
                ["top", "↥"],
                ["middle", "↕"],
                ["bottom", "↧"],
              ] as const
            ).map(([value, icon]) => (
              <button
                key={value}
                title={`Align selected boxes ${value}`}
                onClick={() => onAlign(value)}
              >
                {icon}
              </button>
            ))}
          </div>
          {selectionCount > 2 && (
            <div className="segmented">
              <button onClick={() => onDistribute("x")}>Distribute H</button>
              <button onClick={() => onDistribute("y")}>Distribute V</button>
            </div>
          )}
        </Section>
        <Section title="Combine">
          <button
            className="primary-button inspector-action"
            disabled={!canUnion}
            onClick={onUnion}
            title={unionReason}
          >
            Union shapes
          </button>
          <small>{unionReason}</small>
        </Section>
      </aside>
    );
  const setStyle = (patch: Record<string, unknown>) =>
    onChange({
      style: { ...element.style, ...patch },
    } as Partial<ReportElement>);
  const setUnitValue = (key: "x" | "y" | "width" | "height", value: string) =>
    onChange({
      [key]: toPixels(Number(value), unit),
    } as Partial<ReportElement>);
  const typography = resolveTypography(element.style);
  const setTypography = (patch: Partial<Typography>) =>
    onChange({ style: withTypography(element.style, patch) });
  const managedFamilies = groupFontAssets(fontAssets);
  const semanticFamily = normalizeSemanticFontFamily(typography.fontFamily);
  const activeManagedFaces = managedFamilies.get(semanticFamily) ?? [];
  const activeBuiltin = BUILTIN_FONT_FAMILIES.find(
    (font) => font.family === semanticFamily,
  );
  const availableWeights = [
    ...new Set(
      activeManagedFaces.length
        ? activeManagedFaces.map((asset) => asset.fontWeight ?? 400)
        : (activeBuiltin?.weights ?? [400]),
    ),
  ].sort((a, b) => a - b);
  const availableStyles = [
    ...new Set(
      activeManagedFaces.length
        ? activeManagedFaces
            .filter(
              (asset) =>
                (asset.fontWeight ?? 400) ===
                (Number(typography.fontWeight) || 400),
            )
            .map((asset) => asset.fontStyle ?? "normal")
        : (activeBuiltin?.styles ?? ["normal"]),
    ),
  ];
  const fontFamilies = [
    ...new Set([
      semanticFamily,
      BRAND_FONT_FAMILY,
      ...managedFamilies.keys(),
      ...BUILTIN_FONT_FAMILIES.map((font) => font.family),
    ]),
  ];
  const selectFontFace = (
    family: string,
    weight: number,
    fontStyle: "normal" | "italic",
  ) => {
    const semantic = normalizeSemanticFontFamily(family);
    const face = resolveAvailableManagedFontFace(
      fontAssets,
      semantic,
      weight,
      fontStyle,
    );
    setTypography({
      fontFamily: semantic,
      fontWeight: face?.fontWeight ?? weight,
      fontStyle: face?.fontStyle ?? fontStyle,
      italic: (face?.fontStyle ?? fontStyle) === "italic",
      fontAssetId: face?.id,
      fontChecksum: face?.checksum,
    });
  };
  const fontDiagnostic = diagnoseFontSelection(
    { ...typography, fontFamily: semanticFamily },
    fontAssets,
    fontDiagnostics,
  );
  const cellFontPatch = (
    family: string,
    weight = selectedCellStyle?.fontWeight ?? 400,
    fontStyle = selectedCellStyle?.fontStyle ?? "normal",
  ): Partial<TableCellStyle> => {
    const semantic = normalizeSemanticFontFamily(family);
    const face = resolveAvailableManagedFontFace(
      fontAssets,
      semantic,
      weight,
      fontStyle,
    );
    return {
      fontFamily: semantic,
      fontWeight: face?.fontWeight ?? weight,
      fontStyle: face?.fontStyle ?? fontStyle,
      fontAssetId: face?.id,
      fontChecksum: face?.checksum,
    };
  };
  const fill: Fill = element.style.fill ?? {
    type: "solid",
    color: element.style.background ?? "#E5E7EB",
  };
  const setFill = (next: Fill) =>
    setStyle({ fill: next, background: undefined });
  const stroke = { ...strokeDefaults, ...element.style.stroke };
  const shadow = resolveDropShadow(element.style.shadow);
  const bevel = resolveBevel(element.style.bevel);
  const radii = resolveCornerRadii(
    element.style,
    element.width,
    element.height,
  );
  const bindingPath = element.binding
    ? resolveContextPath(element.binding.path, element.bindingContext)
    : undefined;
  const boundValue = element.binding
    ? getByContextPath(data, element.binding.path, element.bindingContext)
    : undefined;
  const provenance =
    bindingPath && report ? findProvenance(report, bindingPath) : undefined;
  const presentationOverride =
    bindingPath && report
      ? findPresentationOverride(report, bindingPath)
      : undefined;
  const setStroke = (patch: Partial<Stroke>) =>
    setStyle({ stroke: { ...stroke, ...patch } });
  const setShadow = (patch: Partial<DropShadow>) =>
    setStyle({ shadow: { ...shadow, ...patch } });
  const setBevel = (patch: Partial<BevelStyle>) =>
    setStyle({ bevel: { ...bevel, ...patch } });
  const setCorner = (corner: CornerKey, value: number) =>
    setStyle({
      cornerRadii: updateCornerRadius(
        radii,
        corner,
        value,
        element.width,
        element.height,
      ),
    });
  const table =
    element.type === "table" ? (element as TableElement) : undefined;
  const headerBevel = resolveBevel(table?.headerBevel);
  const setHeaderBevel = (patch: Partial<BevelStyle>) =>
    onChange({ headerBevel: { ...headerBevel, ...patch } } as Partial<ReportElement>);
  const setHeaderCornerRadius = (value: number) =>
    onChange({ headerCornerRadius: value } as Partial<ReportElement>);
  const setHeaderRibbonId = (value: string | undefined) =>
    onChange({ headerRibbonId: value } as Partial<ReportElement>);
  const ribbonCandidates = pageElements.filter(
    (candidate): candidate is ShapeElement =>
      candidate.type === "shape" && candidate.id !== element.id,
  );
  const headerTextShadow = resolveDropShadow(table?.headerStyle?.shadow);
  const setHeaderTextShadow = (patch: Partial<DropShadow>) =>
    onChange({
      headerStyle: { ...table?.headerStyle, shadow: { ...headerTextShadow, ...patch } },
    } as Partial<ReportElement>);
  const bodyTextShadow = resolveDropShadow(table?.bodyStyle?.shadow);
  const setBodyTextShadow = (patch: Partial<DropShadow>) =>
    onChange({
      bodyStyle: { ...table?.bodyStyle, shadow: { ...bodyTextShadow, ...patch } },
    } as Partial<ReportElement>);
  const totalsTextShadow = resolveDropShadow(table?.totalStyle?.shadow);
  const setTotalsTextShadow = (patch: Partial<DropShadow>) =>
    onChange({
      totalStyle: { ...table?.totalStyle, shadow: { ...totalsTextShadow, ...patch } },
    } as Partial<ReportElement>);
  const selectedColumn =
    tableSelection && tableSelection.column != null
      ? table?.columns[tableSelection.column]
      : undefined;
  const updateColumn = (patch: Record<string, unknown>) => {
    if (!table || !tableSelection || tableSelection.column == null) return;
    const columnIndex = tableSelection.column;
    onChange({
      columns: table.columns.map((column, index) =>
        index === columnIndex ? { ...column, ...patch } : column,
      ),
    } as Partial<ReportElement>);
  };
  const selectedCellStyle: TableCellStyle | undefined =
    !table || !tableSelection || tableSelection.column == null
      ? undefined
      : tableSelection.section === "column"
        ? table.columns[tableSelection.column]?.bodyStyle
        : tableSelection.section === "header"
          ? table.columns[tableSelection.column]?.headerStyle
          : tableSelection.section === "body"
            ? table.cellStyles?.[
                `body:${tableSelection.row}:${tableSelection.column}`
              ]
            : undefined;
  const selectedCellFamily = normalizeSemanticFontFamily(
    selectedCellStyle?.fontFamily ?? table?.style.fontFamily,
  );
  const selectedCellManagedFaces =
    managedFamilies.get(selectedCellFamily) ?? [];
  const selectedCellBuiltin = BUILTIN_FONT_FAMILIES.find(
    (font) => font.family === selectedCellFamily,
  );
  const selectedCellWeights = [
    ...new Set(
      selectedCellManagedFaces.length
        ? selectedCellManagedFaces.map((asset) => asset.fontWeight ?? 400)
        : (selectedCellBuiltin?.weights ?? [400]),
    ),
  ].sort((a, b) => a - b);
  const selectedCellWeight = selectedCellWeights.includes(
    selectedCellStyle?.fontWeight ?? 400,
  )
    ? (selectedCellStyle?.fontWeight ?? 400)
    : selectedCellWeights[0]!;
  const selectedCellStyles = [
    ...new Set(
      selectedCellManagedFaces.length
        ? selectedCellManagedFaces
            .filter((asset) => (asset.fontWeight ?? 400) === selectedCellWeight)
            .map((asset) => asset.fontStyle ?? "normal")
        : (selectedCellBuiltin?.styles ?? ["normal"]),
    ),
  ];
  const updateTableCellStyle = (patch: Partial<TableCellStyle>) => {
    if (!table || !tableSelection || tableSelection.column == null) return;
    if (tableSelection.section === "column")
      return updateColumn({ bodyStyle: { ...selectedCellStyle, ...patch } });
    if (tableSelection.section === "header")
      return updateColumn({ headerStyle: { ...selectedCellStyle, ...patch } });
    if (tableSelection.section !== "body") return;
    const key = `body:${tableSelection.row}:${tableSelection.column}`;
    onChange({
      cellStyles: {
        ...table.cellStyles,
        [key]: { ...selectedCellStyle, ...patch },
      },
    } as Partial<ReportElement>);
  };
  // Row-level shadow (box-shadow, not the per-cell text shadow above): the
  // header row uses `headerRowShadow`; a semantic body row (rowKindPath
  // resolves to e.g. "total"/"minimum"/"maximum") uses `rowKindShadows`
  // keyed by that resolved kind, taking precedence over a plain row-index
  // shadow for the same row, mirroring how `totalStyle` already wins over
  // plain body styling; any other body row falls back to `bodyRowShadows`
  // keyed by literal row index (see the field's doc comment in report.ts for
  // the reorder/regeneration limitation that keying implies).
  const selectedRowKind =
    table?.rowKindPath && tableSelection?.row != null
      ? String(
          getByContextPath(
            (
              getByContextPath(
                data,
                table.sourcePath,
                table.bindingContext,
              ) as unknown[]
            )?.[tableSelection.row],
            table.rowKindPath,
          ) ?? "",
        )
      : undefined;
  const rowShadowKey: "header" | "kind" | "index" | undefined =
    !table || tableSelection?.section !== "row"
      ? undefined
      : tableSelection.row == null
        ? "header"
        : selectedRowKind
          ? "kind"
          : "index";
  const selectedRowShadow = resolveDropShadow(
    !table || !rowShadowKey
      ? undefined
      : rowShadowKey === "header"
        ? table.headerRowShadow
        : rowShadowKey === "kind"
          ? table.rowKindShadows?.[selectedRowKind ?? ""]
          : table.bodyRowShadows?.[String(tableSelection?.row)],
  );
  const setSelectedRowShadow = (patch: Partial<DropShadow>) => {
    if (!table || !rowShadowKey) return;
    const next = { ...selectedRowShadow, ...patch };
    if (rowShadowKey === "header") {
      onChange({ headerRowShadow: next } as Partial<ReportElement>);
    } else if (rowShadowKey === "kind" && selectedRowKind) {
      onChange({
        rowKindShadows: { ...table.rowKindShadows, [selectedRowKind]: next },
      } as Partial<ReportElement>);
    } else if (tableSelection?.row != null) {
      onChange({
        bodyRowShadows: {
          ...table.bodyRowShadows,
          [String(tableSelection.row)]: next,
        },
      } as Partial<ReportElement>);
    }
  };
  const selectedRow =
    tableSelection?.row == null || !table
      ? undefined
      : (
          getByContextPath(
            data,
            table.sourcePath,
            table.bindingContext,
          ) as unknown[]
        )?.[tableSelection.row];
  const selectedDisplayValue =
    selectedColumn && selectedRow
      ? formatValue(getByContextPath(selectedRow, selectedColumn.path), {
          path: selectedColumn.path,
          format: selectedColumn.format,
          decimals: selectedColumn.decimals,
        })
      : undefined;
  return (
    <aside className="inspector" inert={readOnly ? true : undefined}>
      <div className="inspector-header">
        <div>
          <strong>
            {selectionCount > 1 ? `${selectionCount} elements` : element.name}
          </strong>
          <span>{selectionCount > 1 ? "Multi-selection" : element.type}</span>
        </div>
        <span className="type-chip">{element.type}</span>
      </div>
      <Section title="Position & Size">
        {selectionCount === 1 && (
          <label>
            Layer name
            <input
              value={element.name}
              onChange={(e) =>
                onChange({ name: e.target.value } as Partial<ReportElement>)
              }
            />
          </label>
        )}
        <div className="field-grid">
          <label>
            X <span>{unit}</span>
            <input
              type="number"
              step={unitStep(unit)}
              value={formatUnit(element.x, unit)}
              onChange={(e) => setUnitValue("x", e.target.value)}
            />
          </label>
          <label>
            Y <span>{unit}</span>
            <input
              type="number"
              step={unitStep(unit)}
              value={formatUnit(element.y, unit)}
              onChange={(e) => setUnitValue("y", e.target.value)}
            />
          </label>
        </div>
        <div className="field-grid">
          <label>
            W <span>{unit}</span>
            <input
              type="number"
              min="0"
              step={unitStep(unit)}
              value={formatUnit(element.width, unit)}
              onChange={(e) => setUnitValue("width", e.target.value)}
            />
          </label>
          <label>
            H <span>{unit}</span>
            <input
              type="number"
              min="0"
              step={unitStep(unit)}
              value={formatUnit(element.height, unit)}
              onChange={(e) => setUnitValue("height", e.target.value)}
            />
          </label>
        </div>
        <label>
          Rotation <span>°</span>
          <input
            type="number"
            value={element.rotation ?? 0}
            onChange={(e) =>
              onChange({
                rotation: normalizeRotation(Number(e.target.value)),
              } as Partial<ReportElement>)
            }
          />
        </label>
        <span className="control-label">
          {selectionCount === 1 ? "Align box to page" : "Align selected boxes"}
        </span>
        <div className="icon-grid six" aria-label="Box alignment controls">
          {(
            [
              ["left", "⇤"],
              ["center", "↔"],
              ["right", "⇥"],
              ["top", "↥"],
              ["middle", "↕"],
              ["bottom", "↧"],
            ] as const
          ).map(([value, icon]) => (
            <button
              key={value}
              title={
                selectionCount === 1
                  ? `Align box ${value} to page`
                  : `Align selected boxes ${value}`
              }
              onClick={() => onAlign(value)}
            >
              {icon}
            </button>
          ))}
        </div>
        {selectionCount > 2 && (
          <div className="segmented">
            <button onClick={() => onDistribute("x")}>Distribute H</button>
            <button onClick={() => onDistribute("y")}>Distribute V</button>
          </div>
        )}
      </Section>
      {table && (
        <Section title="Table">
          <button
            className={`crop-button ${tableEditing ? "active" : ""}`}
            onClick={onToggleTableEdit}
          >
            {tableEditing ? "Finish table editing" : "Edit table"}
          </button>
          <label>
            Data source
            <input
              aria-label="Table data source"
              value={table.sourcePath}
              disabled={generated}
              onChange={(event) =>
                onChange({
                  sourcePath: event.target.value,
                } as Partial<ReportElement>)
              }
            />
          </label>
          {generated && <small>Generated report bindings are read-only.</small>}
          <div className="field-grid">
            <label>
              Max rows
              <input
                aria-label="Table max rows"
                type="number"
                min="1"
                value={table.maxRows ?? ""}
                onChange={(event) =>
                  onChange({
                    maxRows: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  } as Partial<ReportElement>)
                }
              />
            </label>
            <label>
              Variant
              <select
                aria-label="Table variant"
                value={table.variant ?? "default"}
                onChange={(event) =>
                  onChange({
                    variant: event.target.value,
                  } as Partial<ReportElement>)
                }
              >
                <option value="default">default</option>
                <option value="market-matrix">market-matrix</option>
                <option value="indicators">indicators</option>
                <option value="transactions">transactions</option>
              </select>
            </label>
          </div>
          <div className="field-grid">
            <label>
              Font
              <select
                aria-label="Table font family"
                value={normalizeSemanticFontFamily(table.style.fontFamily)}
                onChange={(event) =>
                  setStyle(
                    cellFontPatch(
                      event.target.value,
                      table.style.fontWeight ?? 400,
                      table.style.fontStyle ?? "normal",
                    ),
                  )
                }
              >
                {fontFamilies.map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
            </label>
            <label>
              Size
              <input
                aria-label="Table font size"
                type="number"
                min="6"
                value={table.style.fontSize ?? 9}
                onChange={(event) =>
                  setStyle({ fontSize: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <ColorField
            label="Default text color"
            value={table.style.color ?? "#123f55"}
            onChange={(color) => setStyle({ color })}
          />
          <div className="field-grid">
            <label>
              Opacity
              <input
                aria-label="Table opacity"
                type="number"
                min="0"
                max="1"
                step=".05"
                value={table.style.opacity ?? 1}
                onChange={(event) =>
                  setStyle({ opacity: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Row height
              <input
                aria-label="Table row height"
                type="number"
                min="0"
                value={table.rowHeight ?? ""}
                onChange={(event) =>
                  onChange({
                    rowHeight: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  } as Partial<ReportElement>)
                }
              />
            </label>
          </div>
        </Section>
      )}
      {table && tableEditing && tableSelection && selectedColumn && (
        <Section
          title={tableSelection.section === "column" ? "Column" : "Cell"}
        >
          {tableSelection.section !== "column" && (
            <button
              onClick={() =>
                onTableSelectionChange?.({
                  section: "column",
                  column: tableSelection.column,
                })
              }
            >
              Select column
            </button>
          )}
          {(tableSelection.section === "header" ||
            tableSelection.section === "body") && (
            <button
              onClick={() =>
                onTableSelectionChange?.({
                  section: "row",
                  row:
                    tableSelection.section === "body"
                      ? tableSelection.row
                      : undefined,
                })
              }
            >
              Select row
            </button>
          )}
          <label>
            Header label
            <input
              aria-label="Table column header"
              value={selectedColumn.label}
              onChange={(event) => updateColumn({ label: event.target.value })}
            />
          </label>
          <label>
            Binding path
            <input
              aria-label="Table column binding"
              value={selectedColumn.path}
              disabled={generated}
              onChange={(event) => updateColumn({ path: event.target.value })}
            />
          </label>
          <div className="field-grid">
            <label>
              Width %
              <input
                aria-label="Table column width"
                type="number"
                min="1"
                max="100"
                value={selectedColumn.width ?? ""}
                onChange={(event) =>
                  updateColumn({ width: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Alignment
              <select
                aria-label="Table column alignment"
                value={selectedColumn.align ?? "left"}
                onChange={(event) =>
                  updateColumn({ align: event.target.value })
                }
              >
                <option>left</option>
                <option>center</option>
                <option>right</option>
              </select>
            </label>
          </div>
          <div className="field-grid">
            <label>
              Format
              <select
                aria-label="Table column format"
                value={selectedColumn.format ?? "text"}
                onChange={(event) =>
                  updateColumn({ format: event.target.value })
                }
              >
                <option>text</option>
                <option>percentage</option>
                <option>integer</option>
                <option>decimal</option>
                <option>sf</option>
                <option>currency</option>
                <option>currency_psf</option>
              </select>
            </label>
            <label>
              Decimals
              <input
                aria-label="Table column decimals"
                type="number"
                min="0"
                max="6"
                value={selectedColumn.decimals ?? 1}
                onChange={(event) =>
                  updateColumn({ decimals: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <strong>Selection style</strong>
          <div className="field-grid">
            <label>
              Font
              <select
                aria-label="Table selection font"
                value={normalizeSemanticFontFamily(
                  selectedCellStyle?.fontFamily ?? table.style.fontFamily,
                )}
                onChange={(event) =>
                  updateTableCellStyle(cellFontPatch(event.target.value))
                }
              >
                {fontFamilies.map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
            </label>
            <label>
              Weight
              <select
                aria-label="Table selection weight"
                value={selectedCellWeight}
                onChange={(event) =>
                  updateTableCellStyle(
                    cellFontPatch(
                      selectedCellStyle?.fontFamily ??
                        table.style.fontFamily ??
                        BRAND_FONT_FAMILY,
                      Number(event.target.value),
                    ),
                  )
                }
              >
                {selectedCellWeights.map((weight) => (
                  <option key={weight} value={weight}>
                    {weight}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Style
            <select
              aria-label="Table selection style"
              value={
                selectedCellStyles.includes(
                  selectedCellStyle?.fontStyle ?? "normal",
                )
                  ? (selectedCellStyle?.fontStyle ?? "normal")
                  : selectedCellStyles[0]
              }
              onChange={(event) =>
                updateTableCellStyle(
                  cellFontPatch(
                    selectedCellStyle?.fontFamily ??
                      table.style.fontFamily ??
                      BRAND_FONT_FAMILY,
                    selectedCellWeight,
                    event.target.value as "normal" | "italic",
                  ),
                )
              }
            >
              {selectedCellStyles.map((style) => (
                <option key={style} value={style}>
                  {style === "normal" ? "Normal" : "Italic"}
                </option>
              ))}
            </select>
          </label>
          <div className="field-grid">
            <label>
              Size
              <input
                aria-label="Table selection size"
                type="number"
                min="6"
                value={selectedCellStyle?.fontSize ?? table.style.fontSize ?? 9}
                onChange={(event) =>
                  updateTableCellStyle({
                    fontSize: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Padding
              <input
                aria-label="Table selection padding"
                type="number"
                min="0"
                value={selectedCellStyle?.padding ?? 8}
                onChange={(event) =>
                  updateTableCellStyle({
                    padding: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <ColorField
            label="Cell text color"
            value={selectedCellStyle?.color ?? table.style.color ?? "#123f55"}
            onChange={(color) => updateTableCellStyle({ color })}
          />
          <ColorField
            label="Cell fill"
            value={selectedCellStyle?.background ?? "#ffffff"}
            allowNone
            onChange={(background) => updateTableCellStyle({ background })}
          />
          <div className="field-grid">
            <label>
              Border
              <input
                aria-label="Table selection border width"
                type="number"
                min="0"
                value={selectedCellStyle?.borderWidth ?? 0}
                onChange={(event) =>
                  updateTableCellStyle({
                    borderWidth: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Align
              <select
                aria-label="Table selection alignment"
                value={
                  selectedCellStyle?.textAlign ?? selectedColumn.align ?? "left"
                }
                onChange={(event) =>
                  updateTableCellStyle({
                    textAlign: event.target
                      .value as TableCellStyle["textAlign"],
                  })
                }
              >
                <option>left</option>
                <option>center</option>
                <option>right</option>
              </select>
            </label>
          </div>
          <ColorField
            label="Cell border color"
            value={selectedCellStyle?.borderColor ?? "#e4e7ec"}
            onChange={(borderColor) => updateTableCellStyle({ borderColor })}
          />
          <strong>Text shadow</strong>
          <label className="toggle-row">
            <input
              aria-label="Table selection text shadow"
              type="checkbox"
              checked={resolveDropShadow(selectedCellStyle?.shadow).enabled}
              onChange={(event) =>
                updateTableCellStyle({
                  shadow: {
                    ...resolveDropShadow(selectedCellStyle?.shadow),
                    enabled: event.target.checked,
                  },
                })
              }
            />
            <span>
              {resolveDropShadow(selectedCellStyle?.shadow).enabled
                ? "On"
                : "Off"}
            </span>
          </label>
          {resolveDropShadow(selectedCellStyle?.shadow).enabled && (
            <>
              <ColorField
                label="Text shadow color"
                value={resolveDropShadow(selectedCellStyle?.shadow).color}
                onChange={(color) =>
                  updateTableCellStyle({
                    shadow: {
                      ...resolveDropShadow(selectedCellStyle?.shadow),
                      color,
                    },
                  })
                }
              />
              <div className="field-grid">
                {(["offsetX", "offsetY", "blur"] as const).map((key) => (
                  <label key={key}>
                    {key === "offsetX"
                      ? "X offset"
                      : key === "offsetY"
                        ? "Y offset"
                        : "Blur"}
                    <input
                      aria-label={`Table text shadow ${key}`}
                      type="number"
                      min={key === "blur" ? 0 : undefined}
                      step=".5"
                      value={resolveDropShadow(selectedCellStyle?.shadow)[key]}
                      onChange={(event) =>
                        updateTableCellStyle({
                          shadow: {
                            ...resolveDropShadow(selectedCellStyle?.shadow),
                            [key]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Opacity %
                  <input
                    aria-label="Table text shadow opacity"
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(
                      resolveDropShadow(selectedCellStyle?.shadow).opacity *
                        100,
                    )}
                    onChange={(event) =>
                      updateTableCellStyle({
                        shadow: {
                          ...resolveDropShadow(selectedCellStyle?.shadow),
                          opacity: Number(event.target.value) / 100,
                        },
                      })
                    }
                  />
                </label>
              </div>
            </>
          )}
          {tableSelection.section === "body" && (
            <>
              <label>
                Display value
                <input
                  aria-label="Table cell display value"
                  readOnly
                  value={selectedDisplayValue ?? "—"}
                />
              </label>
              <label>
                Source
                <input
                  aria-label="Table cell source"
                  readOnly
                  value={`${table.sourcePath}[${tableSelection.row}].${selectedColumn.path}`}
                />
              </label>
              <small>
                Data-bound report values are read-only; style and formatting
                changes do not modify Salesforce.
              </small>
            </>
          )}
        </Section>
      )}
      {table && tableEditing && tableSelection?.section === "row" && (
        <Section
          title={
            tableSelection.row == null
              ? "Header Row Shadow"
              : selectedRowKind
                ? `${selectedRowKind[0]?.toUpperCase()}${selectedRowKind.slice(1)} Row Shadow`
                : "Row Shadow"
          }
        >
          <button
            onClick={() =>
              onTableSelectionChange?.({
                section: tableSelection.row == null ? "header" : "body",
                column: 0,
                row: tableSelection.row,
              })
            }
          >
            Select cell instead
          </button>
          {tableSelection.row != null && selectedRowKind && (
            <small>
              This row's kind ("{selectedRowKind}") resolves to a semantic
              shadow shared by every row of that kind, taking precedence over
              a plain row-index shadow.
            </small>
          )}
          <ShadowFields
            toggleLabel="Row Shadow"
            fieldPrefix="Row Shadow"
            shadow={selectedRowShadow}
            onChange={setSelectedRowShadow}
          />
        </Section>
      )}
      {(element.type === "shape" || element.type === "text") && (
        <Section title="Fill">
          <div className="segmented">
            <button
              className={fill.type === "solid" ? "active" : ""}
              onClick={() =>
                setFill({
                  type: "solid",
                  color:
                    fill.type === "solid"
                      ? fill.color
                      : (fill.stops[0]?.color ?? "#111827"),
                })
              }
            >
              Solid
            </button>
            <button
              className={fill.type === "linear-gradient" ? "active" : ""}
              onClick={() =>
                setFill({
                  type: "linear-gradient",
                  angle: 90,
                  stops: [
                    { id: "a", color: "#0E2F5A", position: 0 },
                    { id: "b", color: "#4B88C7", position: 100 },
                  ],
                })
              }
            >
              Gradient
            </button>
          </div>
          {fill.type === "solid" ? (
            <ColorField
              label="Color"
              value={fill.color}
              allowNone
              onChange={(color) => setFill({ ...fill, color })}
            />
          ) : (
            <>
              {fill.stops.map((stop, index) => (
                <div className="gradient-row" key={stop.id}>
                  <ColorField
                    label={`Stop ${index + 1}`}
                    value={stop.color}
                    onChange={(color) =>
                      setFill({
                        ...fill,
                        stops: fill.stops.map((s) =>
                          s.id === stop.id ? { ...s, color } : s,
                        ),
                      })
                    }
                  />
                  <label>
                    Pos <span>%</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={stop.position}
                      onChange={(e) =>
                        setFill({
                          ...fill,
                          stops: fill.stops.map((s) =>
                            s.id === stop.id
                              ? { ...s, position: Number(e.target.value) }
                              : s,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <label>
                Angle <span>°</span>
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={fill.angle}
                  onChange={(e) =>
                    setFill({ ...fill, angle: Number(e.target.value) })
                  }
                />
                <input
                  type="number"
                  min="0"
                  max="360"
                  value={fill.angle}
                  onChange={(e) =>
                    setFill({ ...fill, angle: Number(e.target.value) })
                  }
                />
              </label>
              <div className="segmented">
                <button
                  disabled={fill.stops.length >= 3}
                  onClick={() =>
                    setFill({
                      ...fill,
                      stops: [
                        ...fill.stops,
                        {
                          id: crypto.randomUUID(),
                          color: "#D4E8F8",
                          position: 50,
                        },
                      ],
                    })
                  }
                >
                  + Stop
                </button>
                <button
                  disabled={fill.stops.length <= 2}
                  onClick={() =>
                    setFill({ ...fill, stops: fill.stops.slice(0, -1) })
                  }
                >
                  − Stop
                </button>
              </div>
            </>
          )}
        </Section>
      )}
      {element.type === "shape" && (
        <Section title="Bevel">
          <BevelFields bevel={bevel} onChange={setBevel} />
        </Section>
      )}
      {(element.type === "shape" ||
        element.type === "text" ||
        element.type === "image" ||
        element.type === "table") && (
        <Section title={element.type === "table" ? "Table Shadow" : "Drop Shadow"}>
          <ShadowFields
            toggleLabel={element.type === "table" ? "Table Shadow" : "Drop Shadow"}
            shadow={shadow}
            onChange={setShadow}
          />
        </Section>
      )}
      {table && (
        <Section title="Header Appearance">
          <strong>Header bevel</strong>
          <BevelFields
            toggleLabel="Header Bevel"
            bevel={headerBevel}
            onChange={setHeaderBevel}
          />
          <label>
            Header corner radius <span>px</span>
            <input
              aria-label="Header corner radius"
              type="number"
              min="0"
              value={table.headerCornerRadius ?? 0}
              onChange={(event) =>
                setHeaderCornerRadius(Number(event.target.value))
              }
            />
          </label>
          <small>
            Rounds only the header's outer corners — never per cell, and
            never the seam shared with a linked side ribbon.
          </small>
          <label>
            Linked side ribbon
            <select
              aria-label="Header ribbon link"
              value={table.headerRibbonId ?? ""}
              onChange={(event) =>
                setHeaderRibbonId(event.target.value || undefined)
              }
            >
              <option value="">None</option>
              {ribbonCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {table.headerRibbonId && (
            <small>
              {ribbonCandidates.some((candidate) => candidate.id === table.headerRibbonId)
                ? `The header bevel and corner radius above are also applied to "${
                    ribbonCandidates.find((candidate) => candidate.id === table.headerRibbonId)?.name
                  }" as one continuous surface, with the shared edge kept seamless.`
                : "The linked ribbon element was not found on this page."}
            </small>
          )}
        </Section>
      )}
      {table && (
        <Section title="Text Effects">
          <strong>Header text shadow</strong>
          <ShadowFields
            toggleLabel="Header Text Shadow"
            fieldPrefix="Header Text Shadow"
            shadow={headerTextShadow}
            onChange={setHeaderTextShadow}
          />
          <strong>Body text shadow</strong>
          <ShadowFields
            toggleLabel="Body Text Shadow"
            fieldPrefix="Body Text Shadow"
            shadow={bodyTextShadow}
            onChange={setBodyTextShadow}
          />
          {table.rowKindPath && (
            <>
              <strong>Totals text shadow</strong>
              <ShadowFields
                toggleLabel="Totals Text Shadow"
                fieldPrefix="Totals Text Shadow"
                shadow={totalsTextShadow}
                onChange={setTotalsTextShadow}
              />
            </>
          )}
        </Section>
      )}
      {(element.type === "shape" || element.type === "image") && (
        <Section title="Stroke & Corners">
          <label className="toggle-row">
            <input
              aria-label="Stroke"
              type="checkbox"
              checked={stroke.enabled}
              onChange={(e) => setStroke({ enabled: e.target.checked })}
            />
            <span>Stroke</span>
          </label>
          {stroke.enabled && (
            <>
              <ColorField
                label="Stroke color"
                value={stroke.color}
                onChange={(color) => setStroke({ color })}
              />
              <div className="field-grid">
                <label>
                  Width <span>px</span>
                  <input
                    aria-label="Stroke width"
                    type="number"
                    min="0"
                    step=".5"
                    value={stroke.width}
                    onChange={(e) =>
                      setStroke({ width: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Style
                  <select
                    aria-label="Stroke style"
                    value={stroke.style}
                    onChange={(e) =>
                      setStroke({ style: e.target.value as Stroke["style"] })
                    }
                  >
                    <option>solid</option>
                    <option>dashed</option>
                    <option>dotted</option>
                  </select>
                </label>
              </div>
            </>
          )}
          <label className="toggle-row">
            <input
              aria-label="Link corner radii"
              type="checkbox"
              checked={radii.linked}
              onChange={(event) =>
                setStyle({
                  cornerRadii: { ...radii, linked: event.target.checked },
                })
              }
            />
            <span>Link corners</span>
          </label>
          {radii.linked ? (
            <label>
              All corners <span>px</span>
              <input
                aria-label="Corner radius"
                type="range"
                min="0"
                max={Math.min(element.width, element.height) / 2}
                value={radii.topLeft}
                onChange={(event) =>
                  setCorner("topLeft", Number(event.target.value))
                }
              />
              <input
                aria-label="Corner radius value"
                type="number"
                min="0"
                max={Math.min(element.width, element.height) / 2}
                value={Math.round(radii.topLeft * 10) / 10}
                onChange={(event) =>
                  setCorner("topLeft", Number(event.target.value))
                }
              />
            </label>
          ) : (
            <div className="field-grid">
              {(
                [
                  ["topLeft", "Top left"],
                  ["topRight", "Top right"],
                  ["bottomLeft", "Bottom left"],
                  ["bottomRight", "Bottom right"],
                ] as const
              ).map(([corner, label]) => (
                <label key={corner}>
                  {label} <span>px</span>
                  <input
                    aria-label={`${label} radius`}
                    type="number"
                    min="0"
                    max={Math.min(element.width, element.height) / 2}
                    value={Math.round(radii[corner] * 10) / 10}
                    onChange={(event) =>
                      setCorner(corner, Number(event.target.value))
                    }
                  />
                </label>
              ))}
            </div>
          )}
        </Section>
      )}
      {element.type === "text" && (
        <Section title="Typography">
          <label>
            Text
            <textarea
              value={element.text}
              onChange={(e) =>
                onChange({ text: e.target.value } as Partial<ReportElement>)
              }
            />
          </label>
          <label>
            Font
            <select
              aria-label="Font family"
              value={semanticFamily}
              onChange={(e) => {
                const family = e.target.value;
                const firstManaged = managedFamilies.get(family)?.[0];
                const builtin = BUILTIN_FONT_FAMILIES.find(
                  (font) => font.family === family,
                );
                selectFontFace(
                  family,
                  firstManaged?.fontWeight ?? builtin?.weights[0] ?? 400,
                  firstManaged?.fontStyle ?? "normal",
                );
              }}
            >
              <optgroup label="Managed fonts">
                {[
                  ...new Set([BRAND_FONT_FAMILY, ...managedFamilies.keys()]),
                ].map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </optgroup>
              <optgroup label="System fonts">
                {BUILTIN_FONT_FAMILIES.map((font) => (
                  <option key={font.family}>{font.family}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="field-grid">
            <label>
              Weight
              <select
                value={typography.fontWeight}
                onChange={(e) =>
                  selectFontFace(
                    typography.fontFamily,
                    Number(e.target.value),
                    typography.fontStyle ??
                      (typography.italic ? "italic" : "normal"),
                  )
                }
              >
                {availableWeights.map((weight) => (
                  <option key={weight} value={weight}>
                    {weight}{" "}
                    {weight === 400
                      ? "Regular"
                      : weight === 500
                        ? "Medium"
                        : weight === 600
                          ? "SemiBold"
                          : weight === 700
                            ? "Bold"
                            : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Style
              <select
                aria-label="Font style"
                value={
                  typography.fontStyle ??
                  (typography.italic ? "italic" : "normal")
                }
                onChange={(event) =>
                  selectFontFace(
                    semanticFamily,
                    Number(typography.fontWeight),
                    event.target.value as "normal" | "italic",
                  )
                }
              >
                {availableStyles.map((style) => (
                  <option key={style} value={style}>
                    {style === "normal" ? "Normal" : "Italic"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className={`font-resolution ${fontDiagnostic.loaded ? "loaded" : "warning"}`}
          >
            <strong>Resolved face</strong>
            <span>
              {fontDiagnostic.style === "italic" ? "Italic" : "Regular"}{" "}
              {fontDiagnostic.weight}
            </span>
            <small>{fontDiagnostic.message}</small>
          </div>
          <label>
            Size <span>px</span>
            <input
              type="number"
              min="6"
              value={typography.fontSize}
              onChange={(e) =>
                setTypography({ fontSize: Number(e.target.value) })
              }
            />
          </label>
          <ColorField
            label="Text color"
            value={typography.color}
            onChange={(color) => setTypography({ color })}
          />
          <div className="field-grid">
            <label>
              Tracking <span>px</span>
              <input
                type="number"
                step=".1"
                value={typography.letterSpacing}
                onChange={(e) =>
                  setTypography({ letterSpacing: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Line height
              <input
                type="number"
                min=".5"
                step=".05"
                value={typography.lineHeight}
                onChange={(e) =>
                  setTypography({ lineHeight: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <div className="icon-grid text-style-controls">
            <button
              className={typography.underline ? "active" : ""}
              title="Underline"
              onClick={() =>
                setTypography({ underline: !typography.underline })
              }
            >
              <u>U</u>
            </button>
            <button
              className={typography.uppercase ? "active" : ""}
              title="Uppercase"
              onClick={() =>
                setTypography({ uppercase: !typography.uppercase })
              }
            >
              TT
            </button>
          </div>
          <div className="text-alignment-groups">
            <span>Text alignment</span>
            <div className="segmented" aria-label="Horizontal text alignment">
              {(["left", "center", "right", "justify"] as const).map(
                (value) => (
                  <button
                    key={`horizontal-${value}`}
                    className={typography.textAlign === value ? "active" : ""}
                    title={`Text align ${value}`}
                    onClick={() => setTypography({ textAlign: value })}
                  >
                    {value === "justify"
                      ? "Justify"
                      : value[0].toUpperCase() + value.slice(1)}
                  </button>
                ),
              )}
            </div>
            <div className="segmented" aria-label="Vertical text alignment">
              {(["top", "middle", "bottom"] as const).map((value) => (
                <button
                  key={`vertical-${value}`}
                  className={typography.verticalAlign === value ? "active" : ""}
                  title={`Vertically align text ${value}`}
                  onClick={() => setTypography({ verticalAlign: value })}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </Section>
      )}
      {element.type === "image" && (
        <Section title="Image">
          <button className="replace-image-button" onClick={onReplaceImage}>
            Replace Image
          </button>
          <label>
            Fit
            <select
              value={element.fit ?? "cover"}
              onChange={(e) =>
                onChange({ fit: e.target.value } as Partial<ReportElement>)
              }
            >
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="stretch">Stretch</option>
              <option value="original">Original</option>
            </select>
          </label>
          <button
            className={`crop-button ${cropping ? "active" : ""}`}
            onClick={onToggleCrop}
          >
            {cropping ? "Finish cropping" : "Crop image"}
          </button>
          <label>
            Crop zoom <span>%</span>
            <input
              type="range"
              min="100"
              max="400"
              value={Math.round((element.crop?.zoom ?? 1) * 100)}
              onChange={(e) =>
                onChange({
                  crop: {
                    ...(element.crop ?? { x: 50, y: 50, zoom: 1 }),
                    zoom: Number(e.target.value) / 100,
                  },
                } as Partial<ReportElement>)
              }
            />
            <input
              type="number"
              min="100"
              max="400"
              value={Math.round((element.crop?.zoom ?? 1) * 100)}
              onChange={(e) =>
                onChange({
                  crop: {
                    ...(element.crop ?? { x: 50, y: 50, zoom: 1 }),
                    zoom: Number(e.target.value) / 100,
                  },
                } as Partial<ReportElement>)
              }
            />
          </label>
          <div className="field-grid">
            <label>
              Crop X <span>%</span>
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(element.crop?.x ?? 50)}
                onChange={(e) =>
                  onChange({
                    crop: {
                      ...(element.crop ?? { x: 50, y: 50, zoom: 1 }),
                      x: Number(e.target.value),
                    },
                  } as Partial<ReportElement>)
                }
              />
            </label>
            <label>
              Crop Y <span>%</span>
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(element.crop?.y ?? 50)}
                onChange={(e) =>
                  onChange({
                    crop: {
                      ...(element.crop ?? { x: 50, y: 50, zoom: 1 }),
                      y: Number(e.target.value),
                    },
                  } as Partial<ReportElement>)
                }
              />
            </label>
          </div>
          <button
            className="crop-reset"
            onClick={() =>
              onChange({
                crop: { x: 50, y: 50, zoom: 1 },
              } as Partial<ReportElement>)
            }
          >
            Reset crop
          </button>
        </Section>
      )}
      {element.type === "chart" && (
        <>
          <Section title="Chart Data">
            <label>
              Source path
              <input
                value={element.sourcePath}
                onChange={(e) =>
                  onChange({
                    sourcePath: e.target.value,
                  } as Partial<ReportElement>)
                }
              />
            </label>
            <label>
              Category path
              <input
                value={element.categoryPath}
                onChange={(e) =>
                  onChange({
                    categoryPath: e.target.value,
                  } as Partial<ReportElement>)
                }
              />
            </label>
            <label>
              Title
              <input
                value={element.title ?? ""}
                onChange={(e) =>
                  onChange({
                    title: e.target.value,
                  } as Partial<ReportElement>)
                }
              />
            </label>
          </Section>
          <Section title="Chart Type">
            <div className="segmented">
              {(["column", "bar", "line", "area", "combination"] as const).map(
                (type) => (
                  <button
                    key={type}
                    className={element.chartType === type ? "active" : ""}
                    onClick={() =>
                      onChange({ chartType: type } as Partial<ReportElement>)
                    }
                  >
                    {type}
                  </button>
                ),
              )}
            </div>
          </Section>
          <Section title="Series">
            {(element.series ?? []).map((series, index) => (
              <div className="chart-series-row" key={series.id}>
                <label>
                  Name
                  <input
                    value={series.name}
                    onChange={(e) =>
                      onChange({
                        series: element.series?.map((item) =>
                          item.id === series.id
                            ? { ...item, name: e.target.value }
                            : item,
                        ),
                      } as Partial<ReportElement>)
                    }
                  />
                </label>
                <label>
                  Value path
                  <input
                    value={series.valuePath}
                    onChange={(e) =>
                      onChange({
                        series: element.series?.map((item) =>
                          item.id === series.id
                            ? { ...item, valuePath: e.target.value }
                            : item,
                        ),
                      } as Partial<ReportElement>)
                    }
                  />
                </label>
                <ColorField
                  label="Color"
                  value={series.color}
                  onChange={(color) =>
                    onChange({
                      series: element.series?.map((item) =>
                        item.id === series.id ? { ...item, color } : item,
                      ),
                    } as Partial<ReportElement>)
                  }
                />
                <button
                  onClick={() =>
                    onChange({
                      series: element.series?.filter(
                        (item) => item.id !== series.id,
                      ),
                    } as Partial<ReportElement>)
                  }
                >
                  Remove {index + 1}
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                onChange({
                  series: [
                    ...(element.series ?? []),
                    {
                      id: crypto.randomUUID(),
                      name: `Series ${(element.series?.length ?? 0) + 1}`,
                      valuePath: element.valuePath ?? "value",
                      type: "column",
                      color: "#c4123f",
                    },
                  ],
                } as Partial<ReportElement>)
              }
            >
              ＋ Add series
            </button>
          </Section>
          <Section title="Axes & Gridlines">
            <div className="field-grid">
              <label>
                Minimum
                <input
                  type="number"
                  value={element.axes?.[0]?.minimum ?? ""}
                  onChange={(e) =>
                    onChange({
                      axes: [
                        {
                          ...(element.axes?.[0] ?? {
                            id: "value-axis",
                            position: "left",
                          }),
                          minimum:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        },
                      ],
                    } as Partial<ReportElement>)
                  }
                />
              </label>
              <label>
                Maximum
                <input
                  type="number"
                  value={element.axes?.[0]?.maximum ?? ""}
                  onChange={(e) =>
                    onChange({
                      axes: [
                        {
                          ...(element.axes?.[0] ?? {
                            id: "value-axis",
                            position: "left",
                          }),
                          maximum:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        },
                      ],
                    } as Partial<ReportElement>)
                  }
                />
              </label>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={element.axes?.[0]?.showGridlines ?? true}
                onChange={(e) =>
                  onChange({
                    axes: [
                      {
                        ...(element.axes?.[0] ?? {
                          id: "value-axis",
                          position: "left",
                        }),
                        showGridlines: e.target.checked,
                      },
                    ],
                  } as Partial<ReportElement>)
                }
              />
              <span>Show gridlines</span>
            </label>
          </Section>
          <Section title="Legend & Typography">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={element.legend?.visible ?? false}
                onChange={(e) =>
                  onChange({
                    legend: {
                      visible: e.target.checked,
                      position: element.legend?.position ?? "bottom",
                    },
                  } as Partial<ReportElement>)
                }
              />
              <span>Show legend</span>
            </label>
            <label>
              Legend position
              <select
                value={element.legend?.position ?? "bottom"}
                onChange={(e) =>
                  onChange({
                    legend: {
                      visible: element.legend?.visible ?? true,
                      position: e.target.value as
                        "top" | "right" | "bottom" | "left",
                    },
                  } as Partial<ReportElement>)
                }
              >
                <option>top</option>
                <option>right</option>
                <option>bottom</option>
                <option>left</option>
              </select>
            </label>
            <ColorField
              label="Grid color"
              value={element.chartStyle?.gridColor ?? "#d5d9dd"}
              onChange={(gridColor) =>
                onChange({
                  chartStyle: { ...element.chartStyle, gridColor },
                } as Partial<ReportElement>)
              }
            />
          </Section>
        </>
      )}
      <Section title="Appearance">
        <label>
          Opacity <span>%</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round((element.style.opacity ?? 1) * 100)}
            onChange={(e) =>
              setStyle({ opacity: Number(e.target.value) / 100 })
            }
          />
          <input
            type="number"
            min="0"
            max="100"
            value={Math.round((element.style.opacity ?? 1) * 100)}
            onChange={(e) =>
              setStyle({ opacity: Number(e.target.value) / 100 })
            }
          />
        </label>
        <div className="check-row">
          <label>
            <input
              type="checkbox"
              checked={!!element.locked}
              onChange={(e) =>
                onChange({
                  locked: e.target.checked,
                } as Partial<ReportElement>)
              }
            />{" "}
            Lock
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!element.hidden}
              onChange={(e) =>
                onChange({
                  hidden: e.target.checked,
                } as Partial<ReportElement>)
              }
            />{" "}
            Hide
          </label>
        </div>
      </Section>
      <Section title="Data Binding" open={!!element.binding}>
        <label>
          Semantic path
          <input
            placeholder="market.vacancy_rate"
            value={element.binding?.path ?? ""}
            onChange={(e) =>
              onChange({
                binding: e.target.value
                  ? {
                      ...(element.binding ?? { path: "" }),
                      path: e.target.value,
                    }
                  : undefined,
              } as Partial<ReportElement>)
            }
          />
        </label>
        {element.binding && (
          <>
            <label>
              Format
              <select
                value={element.binding.format ?? "text"}
                onChange={(e) =>
                  onChange({
                    binding: {
                      ...element.binding!,
                      format: e.target.value as never,
                    },
                  } as Partial<ReportElement>)
                }
              >
                <option value="text">Text</option>
                <option value="percentage">Percentage</option>
                <option value="integer">Integer</option>
                <option value="decimal">Decimal</option>
                <option value="sf">Square feet</option>
                <option value="currency">Currency</option>
                <option value="currency_psf">$/SF</option>
              </select>
            </label>
            <label>
              Fallback
              <input
                value={element.binding.fallback ?? ""}
                onChange={(e) =>
                  onChange({
                    binding: {
                      ...element.binding!,
                      fallback: e.target.value,
                    },
                  } as Partial<ReportElement>)
                }
              />
            </label>
            <div className="provenance-card">
              <div>
                <span>Resolved value</span>
                <strong>{formatValue(boundValue, element.binding)}</strong>
              </div>
              <div>
                <span>Source authority</span>
                <strong>
                  {provenance?.authority ?? "No provenance record"}
                </strong>
              </div>
              {provenance && (
                <>
                  <div>
                    <span>Status</span>
                    <strong
                      className={`provenance-status ${provenance.status}`}
                    >
                      {provenance.status}
                    </strong>
                  </div>
                  <div>
                    <span>Sources</span>
                    <strong>
                      {provenance.sources
                        .map((source) => source.sourceId)
                        .join(" · ")}
                    </strong>
                  </div>
                  {provenance.calculation && (
                    <div>
                      <span>Calculation lineage</span>
                      <strong>{provenance.calculation.formula}</strong>
                      <small>
                        {provenance.calculation.inputCount} submarket inputs
                      </small>
                    </div>
                  )}
                  {provenance.note && <p>{provenance.note}</p>}
                </>
              )}
              {presentationOverride && (
                <div className="approved-override">
                  <span>Approved presentation value</span>
                  <strong>{String(presentationOverride.value)}</strong>
                  <small>{presentationOverride.reason}</small>
                  <small>
                    {presentationOverride.authority} ·{" "}
                    {new Date(
                      presentationOverride.createdAt,
                    ).toLocaleDateString()}
                  </small>
                </div>
              )}
            </div>
          </>
        )}
      </Section>
    </aside>
  );
}
