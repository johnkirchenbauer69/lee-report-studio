export type ElementType = 'text' | 'shape' | 'image' | 'table' | 'chart';
export type PreviewMode = 'design' | 'data';

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
  style: ElementStyle;
  binding?: Binding;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  fit?: 'cover' | 'contain';
}

export interface TableColumn {
  key: string;
  label: string;
  path: string;
  format?: Binding['format'];
}

export interface TableElement extends BaseElement {
  type: 'table';
  sourcePath: string;
  columns: TableColumn[];
  maxRows?: number;
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
  elements: ReportElement[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  version: string;
  pages: ReportPage[];
}

export interface ValidationItem {
  level: 'ok' | 'warning' | 'error';
  message: string;
  elementId?: string;
}
