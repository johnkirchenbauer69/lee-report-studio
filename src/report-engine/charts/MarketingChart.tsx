import type { ChartElement } from "../../types/report";
import { getByPath } from "../../engine/bindings";
import { fontFamilyToCss } from "../../services/fontRegistry";
import {
  MARKETING_CHART_BASE,
  marketingChartTheme,
} from "./marketingChartTheme";
import {
  catmullRomPath,
  chronologicalQuarterWindow,
  compactCurrency,
  compactNumber,
  compactSquareFeet,
  niceTicks,
  paddedRateDomain,
  percentageTicksForDomain,
  salesPriceTicks,
  wholeCurrency,
} from "./marketingChartScale";

type Row = Record<string, unknown>;
type Margin = { left: number; right: number; top: number; bottom: number };

const numberAt = (row: Row, path: string) => {
  const value = getByPath(row, path);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

const chartRows = (element: ChartElement, source: unknown): Row[] => {
  const rows = Array.isArray(source) ? (source as Row[]) : [];
  return element.marketingChartId === "availability_by_size"
    ? rows
    : chronologicalQuarterWindow(rows, (row) =>
        String(getByPath(row, element.categoryPath)),
      );
};

function Defs({ id }: { id: string }) {
  const theme = marketingChartTheme;
  return (
    <defs>
      <linearGradient id={`${id}-red-gradient`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={theme.palette.red} />
        <stop offset="100%" stopColor={theme.palette.merlot} />
      </linearGradient>
      <filter
        id={`${id}-shadow`}
        x="-20%"
        y="-20%"
        width="160%"
        height="170%"
        colorInterpolationFilters="sRGB"
      >
        <feDropShadow
          dx={theme.shadow.dx}
          dy={theme.shadow.dy}
          stdDeviation={theme.shadow.blur}
          floodColor="#000000"
          floodOpacity={theme.shadow.opacity}
        />
      </filter>
    </defs>
  );
}

const PlotText = ({ children, ...props }: React.SVGProps<SVGTextElement>) => (
  <text fill={marketingChartTheme.palette.gray} {...props}>
    {children}
  </text>
);

function GridAxis({
  ticks,
  y,
  margin,
  format,
  side = "left",
  visibleLabels = true,
}: {
  ticks: number[];
  y: (value: number) => number;
  margin: Margin;
  format: (value: number) => string;
  side?: "left" | "right";
  visibleLabels?: boolean;
}) {
  const { width } = MARKETING_CHART_BASE;
  const compactRightLabels = side === "right" && margin.right < 20;
  return (
    <>
      {ticks.map((tick) => (
        <g key={`${side}-${tick}`}>
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke={marketingChartTheme.palette.gray}
            strokeWidth={marketingChartTheme.gridWidth}
          />
          {visibleLabels && (
            <PlotText
              data-axis-tick={side}
              x={
                side === "left"
                  ? margin.left - 5
                  : compactRightLabels
                    ? width - 1
                    : width - margin.right + 5
              }
              y={y(tick) + 2.5}
              textAnchor={
                side === "left" || compactRightLabels ? "end" : "start"
              }
              fontSize={marketingChartTheme.typography.tick}
            >
              {format(tick)}
            </PlotText>
          )}
        </g>
      ))}
    </>
  );
}

function Categories({
  rows,
  element,
  x,
  y = 190,
}: {
  rows: Row[];
  element: ChartElement;
  x: (index: number) => number;
  y?: number;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <PlotText
          key={`${index}-${String(getByPath(row, element.categoryPath))}`}
          x={x(index)}
          y={y}
          textAnchor="middle"
          fontSize={marketingChartTheme.typography.tick}
        >
          {String(getByPath(row, element.categoryPath))}
        </PlotText>
      ))}
    </>
  );
}

function AxisTitle({
  children,
  x,
  y,
  rotate,
}: {
  children: React.ReactNode;
  x: number;
  y: number;
  rotate?: boolean;
}) {
  return (
    <PlotText
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={marketingChartTheme.typography.axisTitle}
      transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}
    >
      {children}
    </PlotText>
  );
}

function Legend({
  items,
  y = 211,
  gradientId,
}: {
  items: Array<{
    label: string;
    color?: string;
    gradient?: boolean;
    dashed?: boolean;
    line?: boolean;
  }>;
  y?: number;
  gradientId?: string;
}) {
  const widths = items.map((item) => 25 + item.label.length * 4.4);
  const total =
    widths.reduce((sum, value) => sum + value, 0) +
    Math.max(0, items.length - 1) * 8;
  let cursor = (MARKETING_CHART_BASE.width - total) / 2;
  return (
    <>
      {items.map((item, index) => {
        const x = cursor;
        cursor += widths[index]! + 8;
        return (
          <g key={item.label} transform={`translate(${x} ${y})`}>
            {item.line ? (
              <line
                x1="0"
                x2="19"
                y1="-2"
                y2="-2"
                stroke={item.color}
                strokeWidth={marketingChartTheme.lineWidth}
                strokeDasharray={
                  item.dashed ? marketingChartTheme.dash : undefined
                }
              />
            ) : (
              <rect
                x="0"
                y="-6"
                width="19"
                height="7"
                fill={
                  item.gradient && gradientId
                    ? `url(#${gradientId}-red-gradient)`
                    : item.color
                }
              />
            )}
            <PlotText
              x="24"
              y="1"
              fontSize={marketingChartTheme.typography.legend}
            >
              {item.label}
            </PlotText>
          </g>
        );
      })}
    </>
  );
}

function AvailabilityChart({
  element,
  rows,
  id,
}: {
  element: ChartElement;
  rows: Row[];
  id: string;
}) {
  const margin = marketingChartTheme.margins.availability;
  const values = rows.map(
    (row) => numberAt(row, element.valuePath ?? "availableSf") ?? 0,
  );
  const ticks = niceTicks(0, Math.max(1, ...values) * 1.14, 5);
  const maximum = ticks.at(-1) ?? 1;
  const plotWidth = MARKETING_CHART_BASE.width - margin.left - margin.right;
  const plotHeight = MARKETING_CHART_BASE.height - margin.top - margin.bottom;
  const x = (index: number) =>
    margin.left + ((index + 0.5) * plotWidth) / Math.max(rows.length, 1);
  const y = (value: number) => margin.top + (1 - value / maximum) * plotHeight;
  const barWidth = Math.min(38, (plotWidth / Math.max(rows.length, 1)) * 0.58);
  return (
    <>
      <GridAxis ticks={ticks} y={y} margin={margin} format={compactNumber} />
      {values.map((value, index) => (
        <g key={index} filter={`url(#${id}-shadow)`}>
          <rect
            x={x(index) - barWidth / 2}
            y={y(value)}
            width={barWidth}
            height={Math.max(0, y(0) - y(value))}
            fill={`url(#${id}-red-gradient)`}
          />
        </g>
      ))}
      {values.map((value, index) => (
        <PlotText
          key={`label-${index}`}
          x={x(index)}
          y={Math.max(margin.top + 6, y(value) - 4)}
          textAnchor="middle"
          fontSize={marketingChartTheme.typography.barLabel}
          fontWeight={600}
        >
          {compactSquareFeet(value)}
        </PlotText>
      ))}
      <Categories rows={rows} element={element} x={x} y={188} />
      <AxisTitle
        x={12}
        y={(margin.top + MARKETING_CHART_BASE.height - margin.bottom) / 2}
        rotate
      >
        AVAILABLE (SF)
      </AxisTitle>
      <AxisTitle
        x={(margin.left + MARKETING_CHART_BASE.width - margin.right) / 2}
        y={205}
      >
        Size Bucket
      </AxisTitle>
    </>
  );
}

function ConstructionChart({
  element,
  rows,
  id,
}: {
  element: ChartElement;
  rows: Row[];
  id: string;
}) {
  const margin = marketingChartTheme.margins.construction;
  const under = rows.map((row) => numberAt(row, "underConstructionSf") ?? 0);
  const deliveries = rows.map((row) => numberAt(row, "deliveredSf") ?? 0);
  const ticks = niceTicks(0, Math.max(1, ...under, ...deliveries) * 1.14, 6);
  const maximum = ticks.at(-1) ?? 1;
  const plotWidth = MARKETING_CHART_BASE.width - margin.left - margin.right;
  const plotHeight = MARKETING_CHART_BASE.height - margin.top - margin.bottom;
  const x = (index: number) =>
    margin.left + ((index + 0.5) * plotWidth) / Math.max(rows.length, 1);
  const y = (value: number) => margin.top + (1 - value / maximum) * plotHeight;
  const groupWidth = (plotWidth / Math.max(rows.length, 1)) * 0.68;
  const barWidth = groupWidth * 0.43;
  const bars = [
    { values: under, offset: -barWidth / 2, fill: `url(#${id}-red-gradient)` },
    {
      values: deliveries,
      offset: barWidth / 2,
      fill: marketingChartTheme.palette.navy,
    },
  ];
  return (
    <>
      <GridAxis ticks={ticks} y={y} margin={margin} format={compactNumber} />
      {bars.flatMap((series, seriesIndex) =>
        series.values.map((value, index) => (
          <g key={`${seriesIndex}-${index}`} filter={`url(#${id}-shadow)`}>
            <rect
              x={x(index) + series.offset - barWidth / 2}
              y={y(value)}
              width={barWidth}
              height={Math.max(0, y(0) - y(value))}
              fill={series.fill}
            />
          </g>
        )),
      )}
      {bars.flatMap((series, seriesIndex) =>
        series.values.map((value, index) => (
          <PlotText
            key={`label-${seriesIndex}-${index}`}
            x={x(index) + series.offset}
            y={Math.max(margin.top + 5, y(value) - 3)}
            textAnchor="middle"
            fontSize={marketingChartTheme.typography.barLabel}
          >
            {compactSquareFeet(value)}
          </PlotText>
        )),
      )}
      <Categories rows={rows} element={element} x={x} y={188} />
      <AxisTitle
        x={10}
        y={(margin.top + MARKETING_CHART_BASE.height - margin.bottom) / 2}
        rotate
      >
        SQUARE FEET
      </AxisTitle>
      <Legend
        gradientId={id}
        items={[
          { label: "Under Construction", gradient: true },
          { label: "Deliveries", color: marketingChartTheme.palette.navy },
        ]}
      />
    </>
  );
}

function CombinationChart({
  element,
  rows,
  id,
  sales,
}: {
  element: ChartElement;
  rows: Row[];
  id: string;
  sales: boolean;
}) {
  const margin = sales
    ? marketingChartTheme.margins.sales
    : marketingChartTheme.margins.combination;
  const barPath = sales ? "salesVolume" : "quarterlyNetAbsorptionSf";
  const linePaths = sales
    ? ["medianSalesPricePsf"]
    : ["vacancyRate", "availabilityRate"];
  const bars = rows.map((row) => numberAt(row, barPath) ?? 0);
  const lineValues = linePaths.flatMap((path) =>
    rows
      .map((row) => numberAt(row, path))
      .filter((value): value is number => value !== undefined),
  );
  const barMinimum = Math.min(0, ...bars);
  const barMaximum = Math.max(1, ...bars);
  const barTicks = niceTicks(barMinimum * 1.1, barMaximum * 1.1, 5);
  const rightTicks = sales
    ? salesPriceTicks(lineValues)
    : percentageTicksForDomain(paddedRateDomain(lineValues));
  const rightDomain = sales
    ? {
        minimum: rightTicks[0] ?? 0,
        maximum: rightTicks.at(-1) ?? 1,
      }
    : paddedRateDomain(lineValues);
  const plotWidth = MARKETING_CHART_BASE.width - margin.left - margin.right;
  const plotHeight = MARKETING_CHART_BASE.height - margin.top - margin.bottom;
  const x = (index: number) =>
    margin.left + ((index + 0.5) * plotWidth) / Math.max(rows.length, 1);
  const scale = (value: number, ticks: number[]) => {
    const min = ticks[0] ?? 0;
    const max = ticks.at(-1) ?? 1;
    return (
      margin.top +
      ((max - value) / Math.max(max - min, Number.EPSILON)) * plotHeight
    );
  };
  const barY = (value: number) => scale(value, barTicks);
  const rightY = (value: number) =>
    scale(value, [rightDomain.minimum, rightDomain.maximum]);
  const zero = barY(0);
  const barWidth = Math.min(30, (plotWidth / Math.max(rows.length, 1)) * 0.48);
  const colors = sales
    ? [marketingChartTheme.palette.navy]
    : [marketingChartTheme.palette.vacancy, marketingChartTheme.palette.navy];
  return (
    <g
      data-right-axis-min={rightDomain.minimum}
      data-right-axis-max={rightDomain.maximum}
    >
      <GridAxis
        ticks={rightTicks}
        y={rightY}
        margin={margin}
        format={
          sales ? wholeCurrency : (value) => `${Math.round(value * 100)}%`
        }
        side="right"
      />
      {bars.map((value, index) => (
        <g key={`bar-${index}`} filter={`url(#${id}-shadow)`}>
          <rect
            x={x(index) - barWidth / 2}
            y={Math.min(barY(value), zero)}
            width={barWidth}
            height={Math.max(0.5, Math.abs(zero - barY(value)))}
            fill={`url(#${id}-red-gradient)`}
          />
        </g>
      ))}
      {bars.map((value, index) => (
        <PlotText
          key={`bar-label-${index}`}
          x={x(index)}
          y={
            value >= 0
              ? Math.max(margin.top + 5, barY(value) - 3)
              : Math.min(margin.top + plotHeight - 2, barY(value) + 8)
          }
          textAnchor="middle"
          fontSize={marketingChartTheme.typography.barLabel}
        >
          {sales ? compactCurrency(value) : compactSquareFeet(value)}
        </PlotText>
      ))}
      {linePaths.map((path, pathIndex) => {
        const points = rows.flatMap((row, index) => {
          const value = numberAt(row, path);
          return value === undefined ? [] : [{ x: x(index), y: rightY(value) }];
        });
        return (
          <path
            key={path}
            d={catmullRomPath(points)}
            fill="none"
            stroke={colors[pathIndex]}
            strokeWidth={marketingChartTheme.lineWidth}
            strokeDasharray={
              !sales && pathIndex === 0 ? marketingChartTheme.dash : undefined
            }
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${id}-shadow)`}
          />
        );
      })}
      <Categories rows={rows} element={element} x={x} y={188} />
      {sales && !lineValues.length && (
        <PlotText
          x={MARKETING_CHART_BASE.width - margin.right}
          y={margin.top + 8}
          textAnchor="end"
          fontSize={marketingChartTheme.typography.barLabel}
        >
          Median Sales Price unavailable
        </PlotText>
      )}
      {sales && (
        <AxisTitle
          x={350}
          y={(margin.top + MARKETING_CHART_BASE.height - margin.bottom) / 2}
          rotate
        >
          PRICE ($/SF)
        </AxisTitle>
      )}
      <Legend
        gradientId={id}
        items={
          sales
            ? [
                { label: "Sales Volume", gradient: true },
                {
                  label: "Median Sales Price",
                  color: marketingChartTheme.palette.navy,
                  line: true,
                },
              ]
            : [
                { label: "Net Absorption", gradient: true },
                {
                  label: "Vacancy",
                  color: marketingChartTheme.palette.vacancy,
                  line: true,
                  dashed: true,
                },
                {
                  label: "Availability",
                  color: marketingChartTheme.palette.navy,
                  line: true,
                },
              ]
        }
      />
    </g>
  );
}

export function MarketingChart({
  element,
  source,
}: {
  element: ChartElement;
  source: unknown;
}) {
  const rows = chartRows(element, source);
  const id = `marketing-${element.id.replace(/[^a-z0-9-]/gi, "")}`;
  const fontFamily = fontFamilyToCss(
    element.chartStyle?.fontFamily,
    element.chartStyle?.fontAssetId,
  );
  return (
    <div
      className="chart-wrap native-chart marketing-chart"
      data-marketing-chart-id={element.marketingChartId}
    >
      <svg
        viewBox={`0 0 ${MARKETING_CHART_BASE.width} ${MARKETING_CHART_BASE.height}`}
        role="img"
        aria-label={element.name}
        preserveAspectRatio="xMidYMid meet"
        style={{
          fontFamily,
          fontWeight:
            element.chartStyle?.fontWeight ??
            marketingChartTheme.typography.weight,
        }}
      >
        <Defs id={id} />
        {!rows.length ? (
          <PlotText
            x="180"
            y="108"
            textAnchor="middle"
            fontSize={marketingChartTheme.typography.legend}
          >
            Data unavailable
          </PlotText>
        ) : element.marketingChartId === "availability_by_size" ? (
          <AvailabilityChart element={element} rows={rows} id={id} />
        ) : element.marketingChartId === "construction_uc_deliveries" ? (
          <ConstructionChart element={element} rows={rows} id={id} />
        ) : (
          <CombinationChart
            element={element}
            rows={rows}
            id={id}
            sales={element.marketingChartId === "sales_volume_cap_rates"}
          />
        )}
      </svg>
    </div>
  );
}
