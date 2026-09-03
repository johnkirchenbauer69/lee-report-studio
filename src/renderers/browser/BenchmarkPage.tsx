import { CanvasElement } from "../../components/CanvasElement";
import { sampleTemplate } from "../../data/sampleTemplate";
import { sampleData } from "../../data/sampleData";
import type { EditorSettings } from "../../types/report";
import { marketingChartFixture } from "../../report-engine/charts/marketingChartFixture";

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

export function BenchmarkPage({
  pageIndex,
  highlightStates = false,
}: {
  pageIndex: number;
  highlightStates?: boolean;
}) {
  const page =
    sampleTemplate.pages[
      Math.max(0, Math.min(sampleTemplate.pages.length - 1, pageIndex))
    ];
  const fixtureData = {
    ...sampleData,
    availabilityBySize: marketingChartFixture.availabilityBySize,
    historicalPeriods: marketingChartFixture.historicalPeriods,
    market: {
      ...sampleData.submarketDetails[0],
      availabilityBySize: marketingChartFixture.availabilityBySize,
      historicalPeriods: marketingChartFixture.historicalPeriods,
    },
  };
  const data = highlightStates
    ? {
        ...fixtureData,
        topAvailabilities: [
          {
            ...sampleData.topAvailabilities[0],
            image: "",
            state: "image-unavailable",
          },
          sampleData.topAvailabilities[1],
          { address: "", detail: "", image: "", state: "none" },
        ],
        topDeliveries: Array.from({ length: 3 }, () => ({
          address: "",
          detail: "",
          image: "",
          state: "none",
        })),
        topConstruction: [
          sampleData.topConstruction[0],
          sampleData.topConstruction[1],
          { address: "", detail: "", image: "", state: "none" },
        ],
      }
    : fixtureData;
  return (
    <main className="benchmark-shell">
      <section
        className="benchmark-page page-canvas"
        data-page-id={page.id}
        aria-label={page.name}
        style={{
          width: page.width,
          height: page.height,
          backgroundColor: page.background,
        }}
      >
        {page.elements.map((element) => (
          <CanvasElement
            key={element.id}
            element={element}
            elements={page.elements}
            pageSize={page}
            settings={settings}
            data={data}
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
