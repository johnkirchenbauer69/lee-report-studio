export type ElementType = "text" | "shape" | "image" | "table" | "chart";
export type PreviewMode = "design" | "data";
export type Unit = "px" | "in";
export type ShapeKind =
  | "rectangle"
  | "rounded-rectangle"
  | "circle"
  | "ellipse"
  | "line"
  | "triangle"
  | "diamond"
  | "path";
/**
 * A uniform-scale pan/zoom crop within a FIXED-size frame (the ImageElement's
 * own width/height never changes). `zoom` scales the source image uniformly
 * (no independent horizontal/vertical scale), and `x`/`y` are object-position
 * percentages that pan the zoomed image under the frame window.
 *
 * This single representation is sufficient to describe any axis-aligned crop
 * rectangle whose aspect ratio matches the frame's aspect ratio (the only
 * kind of crop rectangle a fixed-size, uniformly-scaled frame can express
 * without distorting the image) -- which is exactly what the interactive
 * crop editor offers (see CanvasElement's crop-mode handles, which resize a
 * frame-aspect-locked rectangle). A crop UI that allowed independently
 * different left/right/top/bottom insets would select a source sub-rect
 * whose aspect ratio can differ from the frame's, which would require
 * anisotropic (non-uniform) scaling to fit back into the unchanged frame --
 * something this uniform-zoom model cannot represent. No such tool is
 * offered, so no additional persisted fields were introduced.
 */
export interface ImageCrop {
  x: number;
  y: number;
  zoom: number;
}
export interface EditorGuide {
  id: string;
  axis: "x" | "y";
  position: number;
}

export interface GradientStop {
  id: string;
  color: string;
  position: number;
}
export type Fill =
  | { type: "solid"; color: string }
  | { type: "linear-gradient"; angle: number; stops: GradientStop[] };

export interface Stroke {
  enabled: boolean;
  color: string;
  width: number;
  opacity: number;
  style: "solid" | "dashed" | "dotted";
}

export interface DropShadow {
  enabled: boolean;
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  opacity: number;
  /** Optional; only meaningful for a container box-shadow, not a text-shadow. */
  spread?: number;
}

export interface BevelStyle {
  enabled: boolean;
  size: number;
  direction: "raised" | "inset";
  highlightColor: string;
  highlightOpacity: number;
  shadowColor: string;
  shadowOpacity: number;
}

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
  linked: boolean;
}

export interface ShapePathGeometry {
  /** Closed polygon rings in coordinates normalized to the element bounds. */
  rings: Array<Array<{ x: number; y: number }>>;
}

export interface Typography {
  fontFamily: string;
  fontWeight: number | string;
  fontStyle?: "normal" | "italic";
  /** Stable references keep a generated report tied to the exact managed face. */
  fontAssetId?: string;
  fontChecksum?: string;
  fontSize: number;
  color: string;
  letterSpacing: number;
  lineHeight: number;
  textAlign: "left" | "center" | "right" | "justify";
  verticalAlign: "top" | "middle" | "bottom";
  italic: boolean;
  underline: boolean;
  uppercase?: boolean;
}

export interface Binding {
  path: string;
  label?: string;
  format?:
    | "text"
    | "percentage"
    | "integer"
    | "decimal"
    | "sf"
    | "currency"
    | "currency_psf";
  decimals?: number;
  fallback?: string;
}

export interface ElementStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontAssetId?: string;
  fontChecksum?: string;
  italic?: boolean;
  textAlign?: "left" | "center" | "right";
  color?: string;
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  cornerRadii?: CornerRadii;
  padding?: number;
  opacity?: number;
  fill?: Fill;
  stroke?: Stroke;
  shadow?: DropShadow;
  bevel?: BevelStyle;
  typography?: Typography;
  letterSpacing?: number;
  lineHeight?: number;
  textDecoration?: "none" | "underline";
  mixBlendMode?: "normal" | "screen" | "multiply";
}

export interface BaseElement {
  id: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  locked?: boolean;
  hidden?: boolean;
  allowOverflow?: boolean;
  groupId?: string;
  style: ElementStyle;
  binding?: Binding;
  bindingContext?: BindingContext;
  repeat?: RepeatRule;
  requiredDataSection?: import("../report-engine/schema/industrialMarketReport").DatasetSection;
  unavailableMessage?: string;
  /** Client-safe copy used when an unavailable fixture is rendered for publication. */
  publishedUnavailableMessage?: string;
  /** Replaces editor/QA diagnostic copy in a published render. */
  publishedText?: string;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
}

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape?: ShapeKind;
  pathGeometry?: ShapePathGeometry;
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  /** Visible images are required for publication unless explicitly opted out. */
  publicationRequired?: boolean;
  fit?: "cover" | "contain" | "stretch" | "original";
  assetId?: string;
  crop?: ImageCrop;
  /**
   * Non-destructive display-pixel inset used to clip a governed raster frame.
   * This is intentionally separate from crop/position controls and is only
   * applied to assets whose source provenance includes an unwanted edge.
   */
  edgeInset?: number;
  sourceCrop?: {
    sourceWidth: number;
    sourceHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface TableColumn {
  key: string;
  label: string;
  path: string;
  format?: Binding["format"];
  decimals?: number;
  width?: number;
  align?: "left" | "center" | "right";
  headerStyle?: TableCellStyle;
  bodyStyle?: TableCellStyle;
}

export interface TableCellStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontAssetId?: string;
  fontChecksum?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  textAlign?: "left" | "center" | "right";
  padding?: number;
  borderColor?: string;
  borderWidth?: number;
  shadow?: DropShadow;
}

export interface TableSelection {
  section: "column" | "header" | "body" | "row";
  /** Not meaningful for "row" selections -- a whole row spans every column. */
  column?: number;
  /**
   * Body row index for "body"/"row" selections. For a "row" selection,
   * `undefined` means the header row is selected (there is only ever one
   * header row, so it needs no index); a number selects that body row.
   */
  row?: number;
}

export interface TableElement extends BaseElement {
  type: "table";
  sourcePath: string;
  columns: TableColumn[];
  maxRows?: number;
  variant?: "default" | "market-matrix" | "indicators" | "transactions";
  rowKindPath?: string;
  emptyMessage?: string;
  rowHeight?: number;
  headerStyle?: TableCellStyle;
  bodyStyle?: TableCellStyle;
  /** Text-shadow-capable styling for rows whose rowKindPath value is "total". */
  totalStyle?: TableCellStyle;
  /** Managed typography for the row-integrated LEE DEAL transaction badge. */
  transactionChipStyle?: TableCellStyle;
  cellStyles?: Record<string, TableCellStyle>;
  /**
   * Box-shadow (not text-shadow) for the header row, rendered as one
   * continuous band across the header cells -- see
   * engine/effects.ts#directionalDropShadowToCss.
   */
  headerRowShadow?: DropShadow;
  /**
   * Box-shadow keyed by the semantic row kind resolved via `rowKindPath`
   * (e.g. "total", "minimum", "maximum" -- whatever values the bound data
   * actually produces). Takes precedence over `bodyRowShadows` for a row
   * whose kind matches a key here, consistent with how `totalStyle` already
   * takes precedence for text styling.
   */
  rowKindShadows?: Record<string, DropShadow>;
  /**
   * Box-shadow keyed by literal body row INDEX (not a stable per-record id --
   * none exists in the current data-binding model, matching the precedent
   * set by `cellStyles`' `"body:{row}:{column}"` keys). LIMITATION: a shadow
   * keyed this way follows the row's on-screen POSITION, not the underlying
   * data record -- if the bound rows are reordered or regenerated, the
   * shadow stays on the same row index rather than following the record it
   * was originally set on.
   */
  bodyRowShadows?: Record<string, DropShadow>;
  /** Raised/inset surface treatment for the header row. Reuses BevelStyle as-is. */
  headerBevel?: BevelStyle;
  /** Rounds only the header's true outer corners; never per-cell, never internal. */
  headerCornerRadius?: number;
  /**
   * Id of a sibling shape element (e.g. a "TOP LEASES" side ribbon) that
   * should be treated as a continuation of this table's header surface: the
   * ribbon and header share headerBevel/headerCornerRadius and the edge
   * where they touch is rendered seamlessly (see engine/tableHeaderGroup.ts).
   */
  headerRibbonId?: string;
}

export interface ChartElement extends BaseElement {
  type: "chart";
  /** Selects the deterministic LEE marketing renderer for governed report charts. */
  marketingChartId?:
    | "availability_by_size"
    | "net_absorption_vacancy_availability"
    | "sales_volume_cap_rates"
    | "construction_uc_deliveries";
  sourcePath: string;
  categoryPath: string;
  valuePath?: string;
  chartType: "bar" | "line" | "area" | "column" | "combination";
  title?: string;
  series?: ChartSeries[];
  axes?: ChartAxis[];
  legend?: ChartLegend;
  chartStyle?: ChartStyle;
}

export interface BindingContext {
  name: string;
  path: string;
}
export interface RepeatRule {
  sourcePath: string;
  contextName?: string;
  direction?: "vertical" | "horizontal";
  maximumItems?: number;
  spacing?: number;
  sortBy?: string;
  sortOrder?: "ascending" | "descending";
}
export interface RepeatingPageRule extends Omit<
  RepeatRule,
  "direction" | "spacing"
> {
  contextName: string;
}
export interface ChartSeries {
  id: string;
  name: string;
  valuePath: string;
  type?: "bar" | "line" | "area" | "column";
  color: string;
  lineWidth?: number;
  markerSize?: number;
  axisId?: string;
}
export interface ChartAxis {
  id: string;
  position: "left" | "right" | "bottom";
  title?: string;
  minimum?: number;
  maximum?: number;
  format?: Binding["format"];
  decimals?: number;
  showGridlines?: boolean;
}
export interface ChartLegend {
  visible: boolean;
  position: "top" | "right" | "bottom" | "left";
}
export interface ChartStyle {
  background?: string;
  gridColor?: string;
  labelColor?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontAssetId?: string;
  fontChecksum?: string;
  fontSize?: number;
}

export type ReportElement =
  TextElement | ShapeElement | ImageElement | TableElement | ChartElement;

export interface ReportPage {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  hidden?: boolean;
  /** Assigned only after repeat expansion and final ordering. */
  pageNumber?: number;
  /** Stable document destination, independent of the page's ordinal position. */
  anchor?: string;
  /** Canonical geography represented by this generated page. */
  geographyId?: string;
  /** Semantic page role used to resolve internal report navigation. */
  pageKind?: "overview" | "highlights";
  bindingContext?: BindingContext;
  repeat?: RepeatingPageRule;
  elements: ReportElement[];
}

export interface Asset {
  id: string;
  name: string;
  type: "image" | "logo" | "font";
  mimeType: string;
  source: string;
  createdAt: string;
  fontFamily?: string;
  /** Embedded OpenType subfamily, retained for governance/audit reporting. */
  fontSubfamily?: string;
  /** Embedded OS/2 width class (1 ultra-condensed through 9 ultra-expanded). */
  fontWidthClass?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  postScriptName?: string;
  checksum?: string;
  scope?: "builtin" | "organization" | "template";
  storageKey?: string;
  license?: {
    type?: string;
    fileName?: string;
    attestedAt?: string;
    attestedBy?: string;
    usageScope?: string;
  };
  /** Production-use policy. Missing legacy values are inferred from license metadata. */
  fontGovernanceStatus?: FontGovernanceStatus;
  version?: number;
  storage?: "backend" | "browser";
  size?: number;
  /** Sanitized immutable provenance for a publication-safe derivative. */
  derivative?: {
    kind: "normalized-salesforce-report-image";
    sourceType: "salesforce";
    sourceMimeType: string;
    sourceSize: number;
    sourceChecksum: string;
    originalWidth: number;
    originalHeight: number;
    outputFormat: "jpeg";
    outputWidth: number;
    outputHeight: number;
    outputSize: number;
    quality: number;
  };
}

export type FontGovernanceStatus =
  "approved" | "unverified" | "restricted" | "retired";

export interface FontReference {
  assetId: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
  checksum: string;
}

export interface EditorSettings {
  unit: Unit;
  gridEnabled: boolean;
  gridSpacingPx: number;
  gridOpacity: number;
  snapToGrid: boolean;
  snapToElements: boolean;
  snapToMargins: boolean;
  marginPx: number;
  marginsEnabled: boolean;
  rulersEnabled?: boolean;
  customGuides?: EditorGuide[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  version: string;
  requiredSections?: import("../report-engine/schema/industrialMarketReport").DatasetSection[];
  optionalSections?: import("../report-engine/schema/industrialMarketReport").DatasetSection[];
  pages: ReportPage[];
  assets?: Asset[];
  settings?: EditorSettings;
}

export interface ValidationItem {
  level: "ok" | "info" | "warning" | "error" | "blocking";
  category?: "data" | "design" | "export";
  message: string;
  elementId?: string;
  path?: string;
}
