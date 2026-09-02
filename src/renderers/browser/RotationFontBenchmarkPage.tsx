import { CanvasElement } from "../../components/CanvasElement";
import { sampleData } from "../../data/sampleData";
import type {
  EditorSettings,
  ReportElement,
  ReportPage,
} from "../../types/report";

const elements: ReportElement[] = [
  {
    id: "rotation-title",
    type: "text",
    name: "Rotated managed-family text",
    x: 56,
    y: 48,
    width: 310,
    height: 62,
    rotation: 17,
    text: "Rotation + Font Fidelity",
    style: {
      typography: {
        fontFamily: "Georgia",
        fontWeight: 700,
        fontStyle: "italic",
        fontSize: 25,
        color: "#7a0d26",
        letterSpacing: 0.2,
        lineHeight: 1.1,
        textAlign: "center",
        verticalAlign: "middle",
        italic: true,
        underline: false,
      },
      shadow: {
        enabled: true,
        color: "#000000",
        offsetX: 3,
        offsetY: 4,
        blur: 5,
        opacity: 0.35,
      },
    },
  },
  {
    id: "rotation-shape",
    type: "shape",
    shape: "rounded-rectangle",
    name: "Rotated shape",
    x: 330,
    y: 150,
    width: 160,
    height: 92,
    rotation: 33,
    style: {
      background: "#0099d8",
      borderRadius: 14,
      opacity: 0.9,
      stroke: {
        enabled: true,
        color: "#003c50",
        width: 3,
        opacity: 1,
        style: "solid",
      },
      shadow: {
        enabled: true,
        color: "#003c50",
        offsetX: 6,
        offsetY: 7,
        blur: 9,
        opacity: 0.4,
      },
    },
  },
  {
    id: "rotation-image",
    type: "image",
    name: "Rotated image",
    x: 44,
    y: 180,
    width: 220,
    height: 132,
    rotation: 315,
    src: "/report-assets/availability-montgomery.png",
    fit: "cover",
    crop: { x: 50, y: 50, zoom: 1 },
    style: {
      opacity: 1,
      borderRadius: 22,
      stroke: {
        enabled: true,
        color: "#c4123f",
        width: 5,
        opacity: 1,
        style: "solid",
      },
    },
  },
  {
    id: "effects-radius-only",
    type: "image",
    name: "Contain image with radius only",
    x: 500,
    y: 70,
    width: 120,
    height: 100,
    src: "/report-assets/availability-montgomery.png",
    fit: "contain",
    crop: { x: 50, y: 50, zoom: 1 },
    style: { opacity: 1, borderRadius: 20 },
  },
  {
    id: "effects-stroke-only",
    type: "image",
    name: "Image with stroke only",
    x: 500,
    y: 205,
    width: 120,
    height: 100,
    src: "/report-assets/availability-montgomery.png",
    fit: "cover",
    crop: { x: 60, y: 40, zoom: 1 },
    style: {
      opacity: 1,
      borderRadius: 0,
      stroke: {
        enabled: true,
        color: "#003c50",
        width: 5,
        opacity: 1,
        style: "solid",
      },
    },
  },
  {
    id: "rotation-table",
    type: "table",
    name: "Rotated table",
    x: 72,
    y: 388,
    width: 360,
    height: 126,
    rotation: 6,
    sourcePath: "topLeaseRows",
    maxRows: 2,
    variant: "transactions",
    columns: [
      { key: "party", label: "TENANT", path: "party", width: 28 },
      { key: "amount", label: "SIZE", path: "amount", width: 22 },
      { key: "address", label: "ADDRESS", path: "address", width: 50 },
    ],
    style: { fontFamily: "Georgia", fontSize: 8, opacity: 1 },
  },
  {
    id: "rotation-chart",
    type: "chart",
    name: "Rotated chart",
    x: 90,
    y: 548,
    width: 330,
    height: 190,
    rotation: 350,
    sourcePath: "periods",
    categoryPath: "period",
    valuePath: "vacancyRate",
    chartType: "line",
    title: "Vacancy trend",
    series: [
      {
        id: "vacancy",
        name: "Vacancy",
        valuePath: "vacancyRate",
        type: "line",
        color: "#c4123f",
        lineWidth: 3,
      },
    ],
    chartStyle: {
      background: "#ffffff",
      gridColor: "#dce3e8",
      labelColor: "#003c50",
      fontFamily: "Georgia",
      fontSize: 9,
    },
    style: { opacity: 1 },
  },
  {
    id: "rotation-ninety",
    type: "text",
    name: "True 90 degree label",
    x: 437,
    y: 500,
    width: 220,
    height: 34,
    rotation: 90,
    text: "TRUE 90° TEXT",
    style: {
      typography: {
        fontFamily: "Georgia",
        fontWeight: 700,
        fontStyle: "normal",
        fontSize: 14,
        color: "#ffffff",
        letterSpacing: 0.8,
        lineHeight: 1,
        textAlign: "center",
        verticalAlign: "middle",
        italic: false,
        underline: false,
      },
      background: "#7a0d26",
      borderRadius: 6,
    },
  },
];

const page: ReportPage = {
  id: "rotation-font-fixture",
  name: "Rotation and Font Fixture",
  width: 650,
  height: 800,
  background: "#f4f7f9",
  elements,
};
export const rotationFontBenchmarkTemplate = {
  id: "effects-render-fixture",
  name: "Effects render fixture",
  version: "1.0.0",
  pages: [page],
};
const settings: EditorSettings = {
  unit: "px",
  gridEnabled: false,
  gridSpacingPx: 24,
  gridOpacity: 0,
  snapToGrid: false,
  snapToElements: false,
  snapToMargins: false,
  marginPx: 0,
  marginsEnabled: false,
  rulersEnabled: false,
  customGuides: [],
};
const noop = () => undefined;

export function RotationFontBenchmarkPage() {
  return (
    <main className="benchmark-shell">
      <section
        className="benchmark-page page-canvas rotation-font-benchmark"
        style={{
          width: page.width,
          height: page.height,
          backgroundColor: page.background,
        }}
      >
        {elements.map((element) => (
          <CanvasElement
            key={element.id}
            element={element}
            elements={elements}
            pageSize={page}
            settings={settings}
            data={sampleData}
            mode="data"
            selected={false}
            zoom={1}
            onSelect={noop}
            onChange={noop}
            onInteractionStart={noop}
            onInteractionEnd={noop}
            onGuides={noop}
            onContextMenu={(event) => event.preventDefault()}
          />
        ))}
      </section>
    </main>
  );
}
