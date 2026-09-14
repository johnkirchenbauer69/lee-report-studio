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

  it("renders the shared shadow model as one box-shadow around the whole table container, never per-cell", () => {
    const markup = renderToStaticMarkup(
      <CanvasElement
        element={{ ...table, style: { shadow } }}
        elements={[{ ...table, style: { shadow } }]}
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
    expect(markup.match(/box-shadow:-3px 5px 8px rgba\(18, 52, 86, 0.4\)/g)).toHaveLength(1);
  });

  it("applies totals text shadow only to rows whose kind is total", () => {
    const totalsTable: TableElement = {
      ...table,
      variant: "market-matrix",
      rowKindPath: "kind",
      totalStyle: { shadow },
      columns: [{ key: "party", label: "SUBMARKET", path: "party" }],
    };
    const markup = renderToStaticMarkup(
      <CanvasElement
        element={totalsTable}
        elements={[totalsTable]}
        pageSize={{ width: 816, height: 1056 }}
        settings={settings}
        data={{
          rows: [
            { party: "North Cook", kind: "detail" },
            { party: "Total", kind: "total" },
          ],
        }}
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
    expect(markup).toContain('class="row-total"');
    expect(markup.match(/text-shadow:-3px 5px 8px rgba\(18, 52, 86, 0.4\)/g)).toHaveLength(1);
  });

  it("applies a header bevel and outer-corner radius to the header row only, with no per-cell shadow on the body", () => {
    const bevel = {
      enabled: true,
      size: 3,
      direction: "raised" as const,
      highlightColor: "#ffffff",
      highlightOpacity: 0.5,
      shadowColor: "#000000",
      shadowOpacity: 0.25,
    };
    const beveledTable: TableElement = {
      ...table,
      headerBevel: bevel,
      headerCornerRadius: 6,
    };
    const markup = renderToStaticMarkup(
      <CanvasElement
        element={beveledTable}
        elements={[beveledTable]}
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
    // Standalone header: both outer corners round; internal seams never do.
    expect(markup).toContain("border-radius:6px 0px 0 0");
    expect(markup).toContain("border-radius:0px 6px 0 0");
    // Every header cell gets the same top/bottom-only edge bevel — no
    // left/right edge shadow, so adjacent cells never show a seam.
    expect(markup.match(/inset 0 3px 3px -3px rgba\(255, 255, 255, 0.5\)/g)).toHaveLength(2);
    expect(markup.match(/inset -?3px 0/g)).toBeNull();
    // The bevel must never reach the body cells.
    const [, bodyMarkup] = markup.split("</thead>");
    expect(bodyMarkup).not.toContain("inset");
  });

  it("disables header bevel and corner radius by default (backward compatible)", () => {
    const markup = renderElement({ ...table });
    expect(markup).not.toContain("inset");
  });
});

describe("CanvasElement Top Leases / Top Sales continuous header group", () => {
  const bevel = {
    enabled: true,
    size: 3,
    direction: "raised" as const,
    highlightColor: "#ffffff",
    highlightOpacity: 0.5,
    shadowColor: "#000000",
    shadowOpacity: 0.25,
  };
  const ribbon: ReportElement = {
    id: "leases-side-bg",
    type: "shape",
    name: "Section Side Bar",
    x: 32,
    y: 0,
    width: 23,
    height: 114,
    style: { background: "#7a0d26" },
  };
  const groupedTable: TableElement = {
    id: "top-leases-table",
    type: "table",
    name: "Top Leases",
    x: 55,
    y: 0,
    width: 729,
    height: 114,
    sourcePath: "rows",
    variant: "transactions",
    headerRibbonId: "leases-side-bg",
    headerBevel: bevel,
    headerCornerRadius: 6,
    columns: [
      { key: "party", label: "TENANT", path: "party" },
      { key: "type", label: "LEASE TYPE", path: "type" },
    ],
    style: {},
  };
  const elements = [ribbon, groupedTable];

  const renderIn = (element: ReportElement) =>
    renderToStaticMarkup(
      <CanvasElement
        element={element}
        elements={elements}
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

  it("suppresses the corner and edge shared with the ribbon on the table's first header cell", () => {
    const markup = renderIn(groupedTable);
    // Outer corner (top-right) still rounds; the ribbon-adjacent corner
    // (top-left of the first cell) never appears as a rounded value.
    expect(markup).toContain("border-radius:0px 6px 0 0");
    expect(markup).not.toContain("border-radius:6px 0px 0 0");
    expect(markup).not.toContain("border-radius:6px 6px 0 0");
  });

  it("gives the linked ribbon the header's bevel with the shared right edge and corner suppressed", () => {
    const markup = renderIn(ribbon);
    // Outer corners (top-left, bottom-left, bottom-right) round; the corner
    // touching the header (top-right) stays square.
    expect(markup).toContain("border-radius:6px 0 6px 6px");
    // Top and left (outer) edges present; right (shared/internal) absent.
    expect(markup).toContain("inset 0 3px"); // top highlight
    expect(markup).toContain("inset 3px 0"); // left highlight
    expect(markup).toContain("inset 0 -3px"); // bottom shadow
    expect(markup).not.toMatch(/inset -3px 0/); // right edge suppressed
  });

  it("does not distort the ribbon's own background fill or an unrelated unlinked shape", () => {
    const markup = renderIn(ribbon);
    expect(markup).toContain("background:#7a0d26");

    const unlinked: ReportElement = {
      ...ribbon,
      id: "unrelated-shape",
      style: { background: "#123456", bevel: { ...bevel, size: 2 } },
    };
    const own = renderToStaticMarkup(
      <CanvasElement
        element={unlinked}
        elements={[unlinked, groupedTable]}
        pageSize={{ width: 816, height: 1056 }}
        settings={settings}
        data={{}}
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
    // An unlinked shape keeps its own independent bevel untouched.
    expect(own).toContain("inset 2px 2px 2px rgba(255, 255, 255, 0.5)");
  });
});

describe("CanvasElement report semantics", () => {
  const renderDataElement = (
    element: ReportElement,
    data: unknown,
    pages?: import("../types/report").ReportPage[],
  ) =>
    renderToStaticMarkup(
      <CanvasElement
        element={element}
        elements={[element]}
        pageSize={{ width: 816, height: 1056 }}
        settings={settings}
        data={data}
        pages={pages}
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

  const propertyImage = (index: number): ReportElement => ({
    id: `delivery-image-${index}`,
    type: "image",
    name: "Property Image",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    src: "",
    publicationRequired: false,
    binding: { path: "property.image" },
    bindingContext: {
      name: "property",
      path: `topDeliveries[${index}]`,
    },
    style: {},
  });

  it("distinguishes empty ranks from genuine image failures", () => {
    const data = {
      topDeliveries: [
        { image: "", state: "image-unavailable" },
        { image: "", state: "none" },
      ],
    };
    expect(renderDataElement(propertyImage(0), data)).toContain(
      "Image unavailable",
    );
    expect(renderDataElement(propertyImage(0), data)).not.toContain(
      "None to Report",
    );
    expect(renderDataElement(propertyImage(1), data)).toContain(
      "None to Report",
    );
    expect(renderDataElement(propertyImage(1), data)).not.toContain(
      "Content not available for this edition",
    );
  });

  it("renders semantic indicator color only on the direction glyph", () => {
    const indicator: TableElement = {
      ...table,
      id: "indicator-table",
      variant: "indicators",
      sourcePath: "indicatorRows",
      columns: [{ key: "metric", label: "MARKET INDICATORS", path: "metric" }],
    };
    const markup = renderDataElement(indicator, {
      indicatorRows: [
        {
          metric: "Vacancy Rate",
          direction: "down",
          semanticStatus: "favorable",
          indicatorKind: "arrow",
          indicatorGlyph: "▼",
          indicatorColor: "#8A941E",
        },
      ],
    });
    expect(markup).toContain('data-direction="down"');
    expect(markup).toContain('data-semantic-status="favorable"');
    expect(markup).toContain('data-indicator-kind="arrow"');
    expect(markup).toContain("color:#8A941E");
    expect(markup).toContain(">Vacancy Rate</span>");
  });

  it("renders the neutral indicator as a thick bar with no arrow glyph", () => {
    const indicator: TableElement = {
      ...table,
      id: "neutral-indicator-table",
      variant: "indicators",
      sourcePath: "indicatorRows",
      columns: [{ key: "metric", label: "MARKET INDICATORS", path: "metric" }],
    };
    const markup = renderDataElement(indicator, {
      indicatorRows: [
        {
          metric: "Under Construction (SF)",
          direction: "up",
          semanticStatus: "neutral",
          indicatorKind: "bar",
          indicatorGlyph: "",
          indicatorColor: "#4E131E",
        },
      ],
    });
    expect(markup).toContain('data-indicator-kind="bar"');
    expect(markup).toContain('class="metric-neutral-bar"');
    expect(markup).toContain("color:#4E131E");
    expect(markup).not.toContain("▲");
    expect(markup).not.toContain("▼");
    expect(markup).not.toContain("→");
  });

  it("renders an accessible internal link from the actual page model", () => {
    const matrix: TableElement = {
      ...table,
      id: "submarket-matrix",
      variant: "market-matrix",
      sourcePath: "submarketTableRows",
      columns: [{ key: "name", label: "SUBMARKET", path: "name" }],
    };
    const pages = [
      {
        id: "ohare-overview-page",
        name: "O'Hare Overview",
        width: 816,
        height: 1056,
        background: "#fff",
        anchor: "ohare-overview",
        geographyId: "ohare",
        pageKind: "overview" as const,
        elements: [],
      },
    ];
    const markup = renderDataElement(
      matrix,
      {
        submarketTableRows: [
          { kind: "detail", geographyId: "ohare", name: "O'Hare" },
        ],
      },
      pages,
    );
    expect(markup).toContain('href="#ohare-overview"');
    expect(markup).toContain('data-page-target="ohare-overview-page"');
    expect(markup).toContain('aria-label="Go to O&#x27;Hare Market Overview"');
    expect(markup).not.toContain("text-decoration:underline");
  });

  it("clips only explicitly normalized map rasters", () => {
    const markup = renderDataElement(
      {
        id: "detail-market-map",
        type: "image",
        name: "Market map",
        x: 0,
        y: 0,
        width: 352,
        height: 240,
        src: "/report-assets/maps/O'Hare_Map.jpg",
        fit: "contain",
        edgeInset: 3,
        style: {},
      },
      {},
    );
    expect(markup).toContain("clip-path:inset(3px)");
    expect(renderElement(propertyImage(0))).not.toContain("clip-path:inset");
  });
});
