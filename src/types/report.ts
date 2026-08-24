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
  | "diamond";
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
  italic?: boolean;
  textAlign?: "left" | "center" | "right";
  color?: string;
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  padding?: number;
  opacity?: number;
  fill?: Fill;
  stroke?: Stroke;
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
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
}

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape?: ShapeKind;
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  fit?: "cover" | "contain" | "stretch" | "original";
  assetId?: string;
  crop?: ImageCrop;
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
  fontSize?: number;
  color?: string;
  background?: string;
  textAlign?: "left" | "center" | "right";
  padding?: number;
  borderColor?: string;
  borderWidth?: number;
}

export interface TableSelection {
  section: "column" | "header" | "body";
  column: number;
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
  cellStyles?: Record<string, TableCellStyle>;
}

export interface ChartElement extends BaseElement {
  type: "chart";
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
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  postScriptName?: string;
  checksum?: string;
  scope?: "builtin" | "organization" | "template";
  storageKey?: string;
  license?: { type?: string; fileName?: string };
  version?: number;
  storage?: "backend" | "browser";
  size?: number;
}

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
}
