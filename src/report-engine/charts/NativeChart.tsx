import type { ChartElement } from "../../types/report";
import {
  formatValue,
  getByContextPath,
  getByPath,
} from "../../engine/bindings";

export function NativeChart({
  element,
  data,
}: {
  element: ChartElement;
  data: unknown;
}) {
  const source = getByContextPath(
    data,
    element.sourcePath,
    element.bindingContext,
  );
  const rows = Array.isArray(source) ? source : [];
  const series = element.series?.length
    ? element.series
    : [
        {
          id: "value",
          name: element.title ?? "Value",
          valuePath: element.valuePath ?? "",
          type:
            element.chartType === "combination" ? "column" : element.chartType,
          color: "#c4123f",
        },
      ];
  const axisFor = (axisId?: string) =>
    element.axes?.find((axis) => axis.id === axisId) ??
    element.axes?.find((axis) => axis.position === "left");
  const scaleFor = (axisId?: string) => {
    const axis = axisFor(axisId);
    const values = series
      .filter(
        (item) =>
          (item.axisId ??
            element.axes?.find((candidate) => candidate.position === "left")
              ?.id) === axis?.id,
      )
      .flatMap((item) =>
        rows.map((row) => Number(getByPath(row, item.valuePath)) || 0),
      );
    const min = axis?.minimum ?? Math.min(0, ...values);
    const max = axis?.maximum ?? Math.max(1, ...values);
    return { axis, min, max, range: Math.max(0.000001, max - min) };
  };
  const primary = scaleFor(
    element.axes?.find((axis) => axis.position === "left")?.id,
  );
  const width = 640,
    height = 230,
    left = 48,
    right = 18,
    top = 25,
    bottom = 45,
    plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const x = (index: number) =>
    left + ((index + 0.5) * plotWidth) / Math.max(rows.length, 1);
  const y = (value: number, axisId?: string) => {
    const scale = axisId ? scaleFor(axisId) : primary;
    return top + ((scale.max - value) / scale.range) * plotHeight;
  };
  const grid = Array.from(
    { length: 5 },
    (_, index) => primary.max - (primary.range * index) / 4,
  );
  const rightAxis = element.axes?.find((item) => item.position === "right");
  const rightScale = rightAxis ? scaleFor(rightAxis.id) : undefined;
  return (
    <div
      className="chart-wrap native-chart"
      style={{ background: element.chartStyle?.background }}
    >
      <div className="chart-title">{element.title}</div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={element.title ?? "Report chart"}
      >
        {grid.map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={width - right}
              y1={y(value)}
              y2={y(value)}
              stroke={element.chartStyle?.gridColor ?? "#d5d9dd"}
              strokeWidth="1"
            />
            <text
              x={left - 6}
              y={y(value) + 4}
              textAnchor="end"
              fontSize="10"
              fill={element.chartStyle?.labelColor ?? "#53616c"}
            >
              {formatValue(value, {
                path: "axis",
                format: primary.axis?.format ?? "integer",
                decimals: primary.axis?.decimals ?? 0,
              })}
            </text>
          </g>
        ))}
        {rightScale &&
          grid.map((_, index) => {
            const value = rightScale.max - (rightScale.range * index) / 4;
            return (
              <text
                key={`right-${index}`}
                x={width - right + 5}
                y={y(value, rightAxis?.id) + 4}
                fontSize="10"
                fill={element.chartStyle?.labelColor ?? "#53616c"}
              >
                {formatValue(value, {
                  path: "axis",
                  format: rightAxis?.format ?? "percentage",
                  decimals: rightAxis?.decimals ?? 1,
                })}
              </text>
            );
          })}
        {series.map((item, seriesIndex) => {
          const points = rows.map((row, index) => ({
            x: x(index),
            y: y(Number(getByPath(row, item.valuePath)) || 0, item.axisId),
            value: Number(getByPath(row, item.valuePath)) || 0,
          }));
          const type = item.type ?? element.chartType;
          if (type === "line")
            return (
              <g key={item.id}>
                <polyline
                  points={points
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ")}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.lineWidth ?? 2.5}
                />
                {points.map((point, index) => (
                  <circle
                    key={index}
                    cx={point.x}
                    cy={point.y}
                    r={item.markerSize ?? 2.5}
                    fill={item.color}
                  />
                ))}
              </g>
            );
          if (type === "area")
            return (
              <path
                key={item.id}
                d={`M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${points.at(-1)?.x ?? left} ${y(0, item.axisId)} L ${points[0]?.x ?? left} ${y(0, item.axisId)} Z`}
                fill={item.color}
                fillOpacity=".25"
                stroke={item.color}
                strokeWidth={item.lineWidth ?? 2}
              />
            );
          const barWidth = Math.max(
            5,
            (plotWidth /
              Math.max(rows.length, 1) /
              Math.max(series.length, 1)) *
              0.65,
          );
          return (
            <g key={item.id}>
              {points.map((point, index) => (
                <rect
                  key={index}
                  x={
                    point.x -
                    barWidth / 2 +
                    (seriesIndex - (series.length - 1) / 2) * barWidth
                  }
                  y={Math.min(point.y, y(0, item.axisId))}
                  width={barWidth}
                  height={Math.max(1, Math.abs(y(0, item.axisId) - point.y))}
                  fill={item.color}
                />
              ))}
            </g>
          );
        })}
        {rows.map((row, index) => (
          <text
            key={index}
            x={x(index)}
            y={height - 18}
            textAnchor="middle"
            fontSize="10"
            fill={element.chartStyle?.labelColor ?? "#53616c"}
          >
            {String(getByPath(row, element.categoryPath)).slice(0, 16)}
          </text>
        ))}
        {element.legend?.visible &&
          series.map((item, index) => (
            <g
              key={item.id}
              transform={`translate(${left + index * 130},${height - 4})`}
            >
              <rect width="12" height="4" y="-8" fill={item.color} />
              <text
                x="17"
                y="-4"
                fontSize="9"
                fill={element.chartStyle?.labelColor ?? "#53616c"}
              >
                {item.name}
              </text>
            </g>
          ))}
      </svg>
    </div>
  );
}
