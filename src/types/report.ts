export type ElementType = 'text' | 'shape' | 'image' | 'table' | 'chart';
export type PreviewMode = 'design' | 'data';
export type Unit = 'px' | 'in';
export type ShapeKind = 'rectangle' | 'rounded-rectangle' | 'circle' | 'ellipse' | 'line' | 'triangle' | 'diamond';
export interface ImageCrop { x: number; y: number; zoom: number; }
export interface EditorGuide { id: string; axis: 'x' | 'y'; position: number; }

export interface GradientStop { id: string; color: string; position: number; }
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'linear-gradient'; angle: number; stops: GradientStop[] };

export interface Stroke {
  enabled: boolean;
  color: string;
  width: number;
  opacity: number;
  style: 'solid' | 'dashed' | 'dotted';
}

export interface Typography {
  fontFamily: string;
  fontWeight: number | string;
  fontSize: number;
  color: string;
  letterSpacing: number;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  verticalAlign: 'top' | 'middle' | 'bottom';
  italic: boolean;
  underline: boolean;
  uppercase?: boolean;
}

export interface Binding {
  path: string;
  label?: string;
  format?: 'text' | 'percentage' | 'integer' | 'decimal' | 'sf' | 'currency' | 'currency_psf';
  decimals?: number;
  fallback?: string;
}

export interface ElementStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  textAlign?: 'left' | 'center' | 'right';
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
  textDecoration?: 'none' | 'underline';
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
  groupId?: string;
  style: ElementStyle;
  binding?: Binding;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape?: ShapeKind;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  fit?: 'cover' | 'contain' | 'stretch' | 'original';
  assetId?: string;
  crop?: ImageCrop;
}

export interface TableColumn {
  key: string;
  label: string;
  path: string;
  format?: Binding['format'];
  decimals?: number;
  width?: number;
  align?: 'left' | 'center' | 'right';
}

export interface TableElement extends BaseElement {
  type: 'table';
  sourcePath: string;
  columns: TableColumn[];
  maxRows?: number;
  variant?: 'default' | 'market-matrix' | 'indicators' | 'transactions';
  rowKindPath?: string;
}

export interface ChartElement extends BaseElement {
  type: 'chart';
  sourcePath: string;
  categoryPath: string;
  valuePath: string;
  chartType: 'bar' | 'line';
  title?: string;
}

export type ReportElement = TextElement | ShapeElement | ImageElement | TableElement | ChartElement;

export interface ReportPage {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  hidden?: boolean;
  elements: ReportElement[];
}

export interface Asset {
  id: string;
  name: string;
  type: 'image' | 'logo' | 'font';
  mimeType: string;
  source: string;
  createdAt: string;
  fontFamily?: string;
  storage?: 'backend' | 'browser';
  size?: number;
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
  pages: ReportPage[];
  assets?: Asset[];
  settings?: EditorSettings;
}

export interface ValidationItem {
  level: 'ok' | 'warning' | 'error';
  message: string;
  elementId?: string;
}
