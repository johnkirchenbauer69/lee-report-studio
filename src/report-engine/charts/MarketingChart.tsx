import React from "react";
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
type OptionalNumber = number | undefined;

export const marketingPlotCenterX = (margin: Pick<Margin, "left" | "right">) =>
  margin.left + (MARKETING_CHART_BASE.width - margin.left - margin.right) / 2;

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

const contiguousPointSegments = (
  values: OptionalNumber[],
  point: (value: number, index: number) => { x: number; y: number },
) => {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  values.forEach((value, index) => {
    if (value === undefined) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(point(value, index));
  });
  if (current.length) segments.push(current);
  return segments;
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

/**
 * A displayable count for a bar: a positive integer, and only when the bar
 * itself has a positive value. A zero/absent bar never gets a chip, even if a
 * malformed source still reports a nonzero count.
 */
export const displayableCount = (
  barValue: number | undefined,
  count: number | undefined,
) =>
  barValue !== undefined &&
  barValue > 0 &&
  count !== undefined &&
  Number.isInteger(count) &&
  count > 0
    ? count
    : undefined;

export const countChipWidth = (count: number) => {
  const chip = marketingChartTheme.countChip;
  return Math.max(
    chip.height,
    String(count).length * chip.fontSize * chip.digitWidth + chip.paddingX * 2,
  );
};

export type ChipPlacement = "inside" | "inside-base" | "above";

/**
 * Picks where a count chip goes for one bar, without touching bar geometry.
 * Preference: inside the upper portion of the bar; when the bar is too short
 * for a legible internal chip, immediately above the bar's value label. Any
 * `avoid` band (e.g. the Median Sales Price line passing through the bar's
 * center) pushes the chip to the next candidate that does not intersect it.
 */
export function placeCountChip({
  barTop,
  barBottom,
  labelTop,
  minimumTop = 0.5,
  avoid = [],
}: {
  barTop: number;
  barBottom: number;
  /** Top edge of the bar's existing value label (text drawn above the bar). */
  labelTop: number;
  minimumTop?: number;
  avoid?: Array<[number, number]>;
}): { top: number; placement: ChipPlacement } {
  const { height, inset } = marketingChartTheme.countChip;
  const fitsInside = barBottom - barTop >= height + inset * 2;
  const overlaps = (top: number) =>
    avoid.some(
      ([a, b]) => top < Math.max(a, b) && top + height > Math.min(a, b),
    );
  const candidates: Array<{ top: number; placement: ChipPlacement }> = [];
  if (fitsInside) {
    candidates.push({ top: barTop + inset, placement: "inside" });
    candidates.push({
      top: barBottom - inset - height,
      placement: "inside-base",
    });
  }
  const aboveTop = labelTop - inset * 0.6 - height;
  candidates.push({ top: aboveTop, placement: "above" });
  for (const [a, b] of avoid) {
    const bandTop = Math.min(a, b);
    if (bandTop < aboveTop)
      candidates.push({
        top: bandTop - inset * 0.6 - height,
        placement: "above",
      });
  }
  const legal = candidates.filter((candidate) => candidate.top >= minimumTop);
  return (
    legal.find((candidate) => !overlaps(candidate.top)) ??
    legal[0] ?? { top: Math.max(minimumTop, aboveTop), placement: "above" }
  );
}

function CountChip({
  kind,
  index,
  count,
  centerX,
  top,
  placement,
}: {
  kind: "buildings" | "sales";
  index: number;
  count: number;
  centerX: number;
  top: number;
  placement: ChipPlacement;
}) {
  const chip = marketingChartTheme.countChip;
  const width = countChipWidth(count);
  return (
    <g
      data-count-chip={kind}
      data-bar-index={index}
      data-count={count}
      data-chip-placement={placement}
      data-chip-top={top}
      data-chip-bottom={top + chip.height}
    >
      <rect
        x={centerX - width / 2}
        y={top}
        width={width}
        height={chip.height}
        rx={chip.radius}
        ry={chip.radius}
        fill={chip.fill}
      />
      <text
        x={centerX}
        y={top + chip.height / 2 + chip.fontSize * 0.35}
        textAnchor="middle"
        fontSize={chip.fontSize}
        fontWeight={chip.fontWeight}
        fill={chip.text}
      >
        {count.toLocaleString("en-US")}
      </text>
    </g>
  );
}

/** Small legend key for the count chips: a sample chip and its meaning. */
function CountChipKey({
  label,
  x,
  y,
  anchor = "start",
}: {
  label: string;
  x: number;
  y: number;
  anchor?: "start" | "end";
}) {
  const chip = marketingChartTheme.countChip;
  const sampleWidth = chip.height + 2;
  const textWidth = label.length * 4.4;
  const left = anchor === "end" ? x - sampleWidth - 4 - textWidth : x;
  return (
    <g data-count-chip-key={label}>
      <rect
        x={left}
        y={y - 7}
        width={sampleWidth}
        height={chip.height - 1}
        rx={chip.radius}
        ry={chip.radius}
        fill={chip.fill}
      />
      <text
        x={left + sampleWidth / 2}
        y={y - 7 + (chip.height - 1) / 2 + chip.fontSize * 0.33}
        textAnchor="middle"
        fontSize={chip.fontSize - 0.6}
        fontWeight={chip.fontWeight}
        fill={chip.text}
      >
        #
      </text>
      <PlotText
        x={left + sampleWidth + 4}
        y={y}
        fontSize={marketingChartTheme.typography.legend}
      >
        {label}
      </PlotText>
    </g>
  );
}

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
  centerX,
  y = 211,
  gradientId,
}: {
  items: Array<{
    label: string;
    color?: string;
    gradient?: boolean;
    dashed?: boolean;
    line?: boolean;
    chip?: boolean;
  }>;
  centerX: number;
  y?: number;
  gradientId?: string;
}) {
  const widths = items.map((item) => 25 + item.label.length * 4.4);
  const total =
    widths.reduce((sum, value) => sum + value, 0) +
    Math.max(0, items.length - 1) * 8;
  let cursor = centerX - total / 2;
  return (
    <g
      data-chart-legend="true"
      data-legend-center-x={centerX}
      data-plot-center-x={centerX}
      data-layout-width={total}
    >
      <rect
        x={centerX - total / 2}
        y={y - 8}
        width={total}
        height="12"
        fill="transparent"
        aria-hidden="true"
      />
      {items.map((item, index) => {
        const x = cursor;
        cursor += widths[index]! + 8;
        return (
          <g key={item.label} transform={`translate(${x} ${y})`}>
            {item.chip ? (
              <g data-count-chip-key={item.label}>
                <rect
                  x="0"
                  y="-7"
                  width="19"
                  height="8.5"
                  rx={marketingChartTheme.countChip.radius}
                  ry={marketingChartTheme.countChip.radius}
                  fill={marketingChartTheme.countChip.fill}
                />
                <text
                  x="9.5"
                  y="-0.6"
                  textAnchor="middle"
                  fontSize={marketingChartTheme.countChip.fontSize - 0.6}
                  fontWeight={marketingChartTheme.countChip.fontWeight}
                  fill={marketingChartTheme.countChip.text}
                >
                  #
                </text>
              </g>
            ) : item.line ? (
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
    </g>
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
  const values = rows.map((row) =>
    numberAt(row, element.valuePath ?? "availableSf"),
  );
  const available = values.filter(
    (value): value is number => value !== undefined,
  );
  const ticks = niceTicks(0, Math.max(1, ...available) * 1.14, 5);
  const maximum = ticks.at(-1) ?? 1;
  const plotWidth = MARKETING_CHART_BASE.width - margin.left - margin.right;
  const plotHeight = MARKETING_CHART_BASE.height - margin.top - margin.bottom;
  const x = (index: number) =>
    margin.left + ((index + 0.5) * plotWidth) / Math.max(rows.length, 1);
  const y = (value: number) => margin.top + (1 - value / maximum) * plotHeight;
  const barWidth = Math.min(38, (plotWidth / Math.max(rows.length, 1)) * 0.58);
  const labelBaseline = (value: number) =>
    Math.max(margin.top + 6, y(value) - 4);
  const labelSize = marketingChartTheme.typography.barLabel;
  // Distinct buildings contributing Available SF to each bucket.
  const chips = values.flatMap((value, index) => {
    const count = displayableCount(
      value,
      numberAt(rows[index]!, "buildingCount"),
    );
    if (value === undefined || count === undefined) return [];
    const placed = placeCountChip({
      barTop: y(value),
      barBottom: y(0),
      labelTop: labelBaseline(value) - labelSize * 0.8,
    });
    return [{ index, count, ...placed }];
  });
  return (
    <>
      <GridAxis ticks={ticks} y={y} margin={margin} format={compactNumber} />
      {values.flatMap((value, index) =>
        value === undefined ? (
          []
        ) : (
          <g key={index} filter={`url(#${id}-shadow)`}>
            <rect
              x={x(index) - barWidth / 2}
              y={y(value)}
              width={barWidth}
              height={Math.max(0, y(0) - y(value))}
              fill={`url(#${id}-red-gradient)`}
            />
          </g>
        ),
      )}
      {values.map((value, index) => (
        <PlotText
          key={`label-${index}`}
          x={x(index)}
          y={value === undefined ? y(0) - 4 : labelBaseline(value)}
          textAnchor="middle"
          fontSize={marketingChartTheme.typography.barLabel}
          fontWeight={600}
        >
          {value === undefined ? "Unavailable" : compactSquareFeet(value)}
        </PlotText>
      ))}
      {chips.map((chip) => (
        <CountChip
          key={`chip-${chip.index}`}
          kind="buildings"
          index={chip.index}
          count={chip.count}
          centerX={x(chip.index)}
          top={chip.top}
          placement={chip.placement}
        />
      ))}
      <Categories rows={rows} element={element} x={x} y={188} />
      <AxisTitle
        x={(margin.left + MARKETING_CHART_BASE.width - margin.right) / 2}
        y={205}
      >
        Size Bucket
      </AxisTitle>
      {chips.length > 0 && (
        <CountChipKey
          label="Buildings"
          x={MARKETING_CHART_BASE.width - margin.right}
          y={205}
          anchor="end"
        />
      )}
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
  const under = rows.map((row) => numberAt(row, "underConstructionSf"));
  const deliveries = rows.map((row) => numberAt(row, "deliveredSf"));
  const available = [...under, ...deliveries].filter(
    (value): value is number => value !== undefined,
  );
  const ticks = niceTicks(0, Math.max(1, ...available) * 1.14, 6);
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
        series.values.map((value, index) =>
          value === undefined ? (
            <title
              key={`missing-${seriesIndex}-${index}`}
            >{`${String(getByPath(rows[index]!, element.categoryPath))}: ${seriesIndex === 0 ? "Under Construction" : "Deliveries"} Unavailable`}</title>
          ) : null,
        ),
      )}
      {bars.flatMap((series, seriesIndex) =>
        series.values.flatMap((value, index) =>
          value === undefined ? (
            []
          ) : (
            <g key={`${seriesIndex}-${index}`} filter={`url(#${id}-shadow)`}>
              <rect
                x={x(index) + series.offset - barWidth / 2}
                y={y(value)}
                width={barWidth}
                height={Math.max(0, y(0) - y(value))}
                fill={series.fill}
              />
            </g>
          ),
        ),
      )}
      {bars.flatMap((series, seriesIndex) =>
        series.values.flatMap((value, index) =>
          value === undefined ? (
            []
          ) : (
            <PlotText
              key={`label-${seriesIndex}-${index}`}
              x={x(index) + series.offset}
              y={
                value === undefined
                  ? y(0) - 3
                  : Math.max(margin.top + 5, y(value) - 3)
              }
              textAnchor="middle"
              fontSize={marketingChartTheme.typography.barLabel}
            >
              {compactSquareFeet(value)}
            </PlotText>
          ),
        ),
      )}
      {bars
        .filter((series) => series.values.every((value) => value === undefined))
        .map((series, index) => (
          <PlotText
            key={`unavailable-series-${index}`}
            data-unavailable-series={
              series === bars[0] ? "underConstructionSf" : "deliveredSf"
            }
            x={MARKETING_CHART_BASE.width - margin.right}
            y={margin.top + 8 + index * 10}
            textAnchor="end"
            fontSize={marketingChartTheme.typography.barLabel}
          >
            {series === bars[0]
              ? "Under Construction unavailable"
              : "Deliveries unavailable"}
          </PlotText>
        ))}
      <Categories rows={rows} element={element} x={x} y={188} />
      <Legend
        centerX={marketingPlotCenterX(margin)}
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
  const bars = rows.map((row) => numberAt(row, barPath));
  const availableBars = bars.filter(
    (value): value is number => value !== undefined,
  );
  const lineValues = linePaths.flatMap((path) =>
    rows
      .map((row) => numberAt(row, path))
      .filter((value): value is number => value !== undefined),
  );
  const barMinimum = Math.min(0, ...availableBars);
  const barMaximum = Math.max(1, ...availableBars);
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
  // `margin` (sales or combination) now shares one plotting rectangle by
  // construction -- see the comment on marketingChartTheme.margins.sales --
  // so this plain formula, using this chart's own plotWidth, already
  // produces identical bar width/position/spacing for both paired charts.
  const barWidth = Math.min(30, (plotWidth / Math.max(rows.length, 1)) * 0.48);
  const barLabelBaseline = (value: number) =>
    value >= 0
      ? Math.max(margin.top + 5, barY(value) - 3)
      : Math.min(margin.top + plotHeight - 2, barY(value) + 8);
  // Qualifying sale transactions behind each Sales Volume bar. Rendered only
  // from the governed count field; never inferred from volume.
  const medianValues = sales
    ? rows.map((row) => numberAt(row, "medianSalesPricePsf"))
    : [];
  const lineBand = (index: number): Array<[number, number]> => {
    const own = medianValues[index];
    if (own === undefined) return [];
    const half = barWidth / 2;
    const ys = [rightY(own)];
    for (const neighbor of [index - 1, index + 1]) {
      const other = medianValues[neighbor];
      if (other === undefined) continue;
      const share = half / Math.abs(x(neighbor) - x(index));
      ys.push(rightY(own) + (rightY(other) - rightY(own)) * share);
    }
    const pad = marketingChartTheme.lineWidth + 1.2;
    return [[Math.min(...ys) - pad, Math.max(...ys) + pad]];
  };
  const salesChips = sales
    ? bars.flatMap((value, index) => {
        const count = displayableCount(
          value,
          numberAt(rows[index]!, "salesTransactions"),
        );
        if (value === undefined || count === undefined) return [];
        const placed = placeCountChip({
          barTop: Math.min(barY(value), zero),
          barBottom: Math.max(barY(value), zero),
          labelTop:
            barLabelBaseline(value) -
            marketingChartTheme.typography.barLabel * 0.8,
          avoid: lineBand(index),
        });
        return [{ index, count, ...placed }];
      })
    : [];
  const colors = sales
    ? [marketingChartTheme.palette.navy]
    : [marketingChartTheme.palette.vacancy, marketingChartTheme.palette.navy];
  return (
    <g
      data-line-axis-min={rightDomain.minimum}
      data-line-axis-max={rightDomain.maximum}
    >
      <GridAxis
        ticks={rightTicks}
        y={rightY}
        margin={margin}
        format={
          sales ? wholeCurrency : (value) => `${Math.round(value * 100)}%`
        }
        side="left"
      />
      {bars.flatMap((value, index) =>
        value === undefined ? (
          []
        ) : (
          <g key={`bar-${index}`} filter={`url(#${id}-shadow)`}>
            <rect
              data-bar-index={index}
              x={x(index) - barWidth / 2}
              y={Math.min(barY(value), zero)}
              width={barWidth}
              height={Math.max(0.5, Math.abs(zero - barY(value)))}
              fill={`url(#${id}-red-gradient)`}
            />
          </g>
        ),
      )}
      {bars.map((value, index) => (
        <PlotText
          key={`bar-label-${index}`}
          x={x(index)}
          y={value === undefined ? zero - 3 : barLabelBaseline(value)}
          textAnchor="middle"
          fontSize={marketingChartTheme.typography.barLabel}
        >
          {value === undefined
            ? bars.every((item) => item === undefined)
              ? ""
              : "Unavailable"
            : sales
              ? compactCurrency(value)
              : compactSquareFeet(value)}
        </PlotText>
      ))}
      {linePaths.map((path, pathIndex) => {
        const values = rows.map((row) => numberAt(row, path));
        const segments = contiguousPointSegments(values, (value, index) => ({
          x: x(index),
          y: rightY(value),
        }));
        return (
          <g key={path} data-series={path}>
            {segments.map((points, segmentIndex) => (
              <path
                key={segmentIndex}
                d={catmullRomPath(points)}
                fill="none"
                stroke={colors[pathIndex]}
                strokeWidth={marketingChartTheme.lineWidth}
                strokeDasharray={
                  !sales && pathIndex === 0
                    ? marketingChartTheme.dash
                    : undefined
                }
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={`url(#${id}-shadow)`}
              />
            ))}
            {values.map((value, index) =>
              value === undefined ? (
                <title key={`unavailable-${index}`}>
                  {`${String(getByPath(rows[index]!, element.categoryPath))}: Unavailable`}
                </title>
              ) : null,
            )}
          </g>
        );
      })}
      {salesChips.map((chip) => (
        <CountChip
          key={`chip-${chip.index}`}
          kind="sales"
          index={chip.index}
          count={chip.count}
          centerX={x(chip.index)}
          top={chip.top}
          placement={chip.placement}
        />
      ))}
      <Categories rows={rows} element={element} x={x} y={188} />
      {sales && bars.every((value) => value === undefined) && (
        <PlotText
          x={MARKETING_CHART_BASE.width - margin.right}
          y={margin.top + 18}
          textAnchor="end"
          data-unavailable-series="salesVolume"
          fontSize={marketingChartTheme.typography.barLabel}
        >
          Sales Volume unavailable
        </PlotText>
      )}
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
      <Legend
        centerX={marketingPlotCenterX(margin)}
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
                ...(salesChips.length ? [{ label: "Sales", chip: true }] : []),
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
