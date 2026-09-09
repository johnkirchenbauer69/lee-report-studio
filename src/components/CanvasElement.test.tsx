import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasElement } from "./CanvasElement";
import type {
  EditorSettings,
  ReportElement,
  TableElement,
} from "../types/report";

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
};

const table: TableElement = {
  id: "top-leases-table",
  type: "table",
  name: "Top Leases",
  x: 0,
  y: 0,
  width: 729,
  height: 114,
  sourcePath: "rows",
  maxRows: 3,
  variant: "transactions",
  transactionChipStyle: {
    fontFamily: "Nunito Sans",
    fontWeight: 900,
    fontStyle: "normal",
    fontAssetId: "nunito-black",
    fontChecksum: "nunito-black-checksum",
  },
  columns: [
    { key: "party", label: "TENANT", path: "party", width: 70 },
    { key: "type", label: "LEASE TYPE", path: "type", width: 30 },
  ],
  style: {},
};

const render = (rows: unknown[]) =>
  renderToStaticMarkup(
    <CanvasElement
      element={table}
      elements={[table]}
      pageSize={{ width: 816, height: 1056 }}
      settings={settings}
      data={{ rows }}
      mode="data"
      selected={false}
      zoom={1}
      onSelect={() => undefined}
      onChange={() => undefined}
      onInteractionStart={() => undefined}
      onInteractionEnd={() => undefined}
      onGuides={() => undefined}
      onContextMenu={() => undefined}
    />,
  );

const renderElement = (element: ReportElement) =>
  renderToStaticMarkup(
    <CanvasElement
      element={element}
      elements={[element]}
      pageSize={{ width: 816, height: 1056 }}
      settings={settings}
      data={{}}
      mode="design"
      selected={false}
      zoom={1}
      onSelect={() => undefined}
      onChange={() => undefined}
      onInteractionStart={() => undefined}
      onInteractionEnd={() => undefined}
      onGuides={() => undefined}
      onContextMenu={() => undefined}
    />,
  );

describe("CanvasElement transaction Lee Deal chip", () => {
  it("renders one row-integrated chip only for an exact true boolean", () => {
    const markup = render([
      { party: "Lee Tenant", type: "Direct / New", isLeeDeal: true },
      { party: "Other Tenant", type: "Renewal", isLeeDeal: false },
      { party: "Unknown Tenant", type: "New", isLeeDeal: null },
    ]);

    expect(markup.match(/data-testid="lee-deal-chip"/g)).toHaveLength(1);
    expect(markup).toContain("transaction-type-cell");
    expect(markup).toContain("LEE DEAL");
    expect(markup).toContain('data-font-asset-id="nunito-black"');
    expect(markup).toContain('data-font-checksum="nunito-black-checksum"');
    expect(markup).toContain("LEE Managed nunito-black");
    expect(markup).toContain("font-weight:900");
    expect(markup).toContain("font-style:normal");
  });

  it("does not render a chip for a placeholder row", () => {
    expect(render([{ party: "-", type: "-", isLeeDeal: false }])).not.toContain(
      "LEE DEAL",
    );
  });
});

describe("CanvasElement report manual overrides", () => {
  it("renders the durable override instead of the generated binding value", () => {
    const element: ReportElement = {
      id: "bound-text",
      type: "text",
      name: "Bound text",
      text: "Template fallback",
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      binding: { path: "market.name" },
      style: {},
    };
    const markup = renderToStaticMarkup(
      <CanvasElement
        element={element}
        elements={[element]}
        pageSize={{ width: 816, height: 1056 }}
        settings={settings}
        data={{ market: { name: "Generated market" } }}
        manualOverrides={[
          {
            elementId: element.id,
            bindingPath: "market.name",
            generatedValue: "Generated market",
            overrideValue: "Reviewed market",
            createdAt: "2026-09-08T10:00:00.000Z",
          },
        ]}
        mode="data"
        selected={false}
        zoom={1}
        onSelect={() => undefined}
        onChange={() => undefined}
        onInteractionStart={() => undefined}
        onInteractionEnd={() => undefined}
        onGuides={() => undefined}
        onContextMenu={() => undefined}
      />,
    );
    expect(markup).toContain("Reviewed market");
    expect(markup).not.toContain("Generated market");
  });
});

describe("CanvasElement effects", () => {
  const shadow = {
    enabled: true,
    color: "#123456",
    offsetX: -3,
    offsetY: 5,
    blur: 8,
    opacity: 0.4,
  } as const;

  it("renders the shared shadow model as text-shadow for text", () => {
    const markup = renderElement({
      id: "shadow-text",
      type: "text",
      name: "Shadow text",
      text: "Shadow",
      x: 10,
      y: 20,
      width: 120,
      height: 30,
      style: { shadow },
    });

    expect(markup).toContain("text-shadow:-3px 5px 8px rgba(18, 52, 86, 0.4)");
    expect(markup).not.toContain("box-shadow:");
  });

  it("renders the shared shadow model as box-shadow for shapes", () => {
    const markup = renderElement({
      id: "shadow-shape",
      type: "shape",
      name: "Shadow shape",
      shape: "rounded-rectangle",
      x: 10,
      y: 20,
      width: 120,
      height: 60,
      style: { background: "#ffffff", shadow },
    });

    expect(markup).toContain("box-shadow:-3px 5px 8px rgba(18, 52, 86, 0.4)");
    expect(markup).not.toContain("text-shadow:");
  });

  it("keeps disabled shadows absent", () => {
    const markup = renderElement({
      id: "plain-shape",
      type: "shape",
      name: "Plain shape",
      x: 10,
      y: 20,
      width: 120,
      height: 60,
      style: { shadow: { ...shadow, enabled: false } },
    });

    expect(markup).not.toContain("box-shadow:");
    expect(markup).not.toContain("text-shadow:");
  });

  it("renders image stroke geometry and a dedicated clipping wrapper", () => {
    const markup = renderElement({
      id: "rounded-image",
      type: "image",
      name: "Rounded image",
      src: "/image.png",
      fit: "cover",
      crop: { x: 35, y: 65, zoom: 1.4 },
      x: 10,
      y: 20,
      width: 120,
      height: 60,
      style: {
        cornerRadii: {
          topLeft: 18,
          topRight: 12,
          bottomRight: 6,
          bottomLeft: 2,
          linked: false,
        },
        shadow,
        stroke: {
          enabled: true,
          color: "#c4123f",
          width: 4,
          opacity: 1,
          style: "solid",
        },
      },
    });

    expect(markup).toContain("border-radius:18px 12px 6px 2px");
    expect(markup).toContain("box-shadow:-3px 5px 8px rgba(18, 52, 86, 0.4)");
    expect(markup).toContain("border-width:4px");
    expect(markup).toContain("border-color:#c4123f");
    expect(markup).toContain('data-image-clip="true"');
    expect(markup).toContain("object-fit:cover");
  });

  it("applies a targeted table header shadow without affecting body cells", () => {
    const styledTable: TableElement = {
      ...table,
      columns: [
        { ...table.columns[0], headerStyle: { shadow } },
        table.columns[1],
      ],
    };
    const markup = renderToStaticMarkup(
      <CanvasElement
        element={styledTable}
        elements={[styledTable]}
        pageSize={{ width: 816, height: 1056 }}
        settings={settings}
        data={{ rows: [{ party: "Tenant", type: "New" }] }}
        mode="data"
        selected={false}
        zoom={1}
        onSelect={() => undefined}
        onChange={() => undefined}
        onInteractionStart={() => undefined}
        onInteractionEnd={() => undefined}
        onGuides={() => undefined}
        onContextMenu={() => undefined}
      />,
    );
    expect(
      markup.match(/text-shadow:-3px 5px 8px rgba\(18, 52, 86, 0.4\)/g),
    ).toHaveLength(1);
  });

  it("renders union path geometry as editable SVG", () => {
    const markup = renderElement({
      id: "union",
      type: "shape",
      shape: "path",
      name: "Union",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      style: { fill: { type: "solid", color: "#c4123f" } },
      pathGeometry: {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        ],
      },
    });
    expect(markup).toContain("shape-path-svg");
    expect(markup).toContain('fill="#c4123f"');
    expect(markup).toContain("M0 0 L100 0 L100 50 L0 50 Z");
  });
});
