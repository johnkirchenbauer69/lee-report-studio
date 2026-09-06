import {
  union,
  type MultiPolygon,
  type Polygon,
  type Ring,
} from "polygon-clipping";
import type { ReportElement, ShapeElement } from "../types/report";
import { rotatePoint } from "./geometry";
import { resolveCornerRadii } from "./corners";

type Point = { x: number; y: number };

const closeRing = (points: Point[]): Ring => {
  const ring = points.map(({ x, y }) => [x, y] as [number, number]);
  const first = ring[0];
  const last = ring.at(-1);
  if (first && last && (first[0] !== last[0] || first[1] !== last[1]))
    ring.push([...first]);
  return ring;
};

const arc = (
  points: Point[],
  cx: number,
  cy: number,
  radius: number,
  start: number,
) => {
  for (let step = 0; step <= 5; step += 1) {
    const angle = start + (Math.PI / 2) * (step / 5);
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
};

function localRings(element: ShapeElement): Point[][] {
  const { width: w, height: h } = element;
  if (element.shape === "path" && element.pathGeometry)
    return element.pathGeometry.rings.map((ring) =>
      ring.map((point) => ({ x: point.x * w, y: point.y * h })),
    );
  if (element.shape === "circle" || element.shape === "ellipse") {
    return [
      Array.from({ length: 33 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 32;
        return {
          x: w / 2 + Math.cos(angle) * (w / 2),
          y: h / 2 + Math.sin(angle) * (h / 2),
        };
      }),
    ];
  }
  if (element.shape === "triangle")
    return [
      [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
    ];
  if (element.shape === "diamond")
    return [
      [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ],
    ];
  if (element.shape === "line") {
    const thickness = Math.max(2, element.style.stroke?.width ?? h);
    const top = (h - thickness) / 2;
    return [
      [
        { x: 0, y: top },
        { x: w, y: top },
        { x: w, y: top + thickness },
        { x: 0, y: top + thickness },
      ],
    ];
  }
  const radii = resolveCornerRadii(element.style, w, h);
  if (
    element.shape === "rounded-rectangle" &&
    Object.values(radii).some((value) => typeof value === "number" && value > 0)
  ) {
    const points: Point[] = [];
    arc(points, radii.topLeft, radii.topLeft, radii.topLeft, Math.PI);
    arc(
      points,
      w - radii.topRight,
      radii.topRight,
      radii.topRight,
      -Math.PI / 2,
    );
    arc(
      points,
      w - radii.bottomRight,
      h - radii.bottomRight,
      radii.bottomRight,
      0,
    );
    arc(
      points,
      radii.bottomLeft,
      h - radii.bottomLeft,
      radii.bottomLeft,
      Math.PI / 2,
    );
    return [points];
  }
  return [
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
  ];
}

function asPolygon(element: ShapeElement): Polygon {
  const center = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
  return localRings(element).map((ring) =>
    closeRing(
      ring.map((point) =>
        rotatePoint(
          { x: point.x + element.x, y: point.y + element.y },
          center,
          element.rotation ?? 0,
        ),
      ),
    ),
  );
}

export type ShapeUnionAvailability = {
  enabled: boolean;
  reason: string;
};

export function evaluateShapeUnion(
  elements: ReportElement[],
): ShapeUnionAvailability {
  if (elements.length < 2)
    return { enabled: false, reason: "Select at least two shapes." };
  if (elements.some((element) => element.type !== "shape"))
    return { enabled: false, reason: "Union is available only for shapes." };
  try {
    const result = union(
      asPolygon(elements[0] as ShapeElement),
      ...elements.slice(1).map((element) => asPolygon(element as ShapeElement)),
    );
    if (result.length !== 1)
      return { enabled: false, reason: "Selected shapes must intersect." };
    return { enabled: true, reason: "Combine intersecting shapes." };
  } catch {
    return { enabled: false, reason: "Selected shape geometry is invalid." };
  }
}

export function createUnionShape(
  elements: ShapeElement[],
  id: string,
  name = "Union",
): ShapeElement {
  const result: MultiPolygon = union(
    asPolygon(elements[0]),
    ...elements.slice(1).map(asPolygon),
  );
  if (result.length !== 1)
    throw new Error("Selected shapes must form one intersecting union.");
  const rings = result[0];
  const points = rings.flat();
  const minX = Math.min(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxX = Math.max(...points.map(([x]) => x));
  const maxY = Math.max(...points.map(([, y]) => y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const topmost = elements.at(-1)!;
  return {
    id,
    type: "shape",
    shape: "path",
    name,
    x: minX,
    y: minY,
    width,
    height,
    rotation: 0,
    style: {
      ...structuredClone(topmost.style),
      borderRadius: 0,
      cornerRadii: {
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
        linked: true,
      },
    },
    pathGeometry: {
      rings: rings.map((ring) =>
        ring.map(([x, y]) => ({
          x: (x - minX) / width,
          y: (y - minY) / height,
        })),
      ),
    },
  };
}

export const shapePathToSvg = (element: ShapeElement) =>
  element.pathGeometry?.rings
    .map(
      (ring) =>
        ring
          .map(
            (point, index) =>
              `${index === 0 ? "M" : "L"}${point.x * element.width} ${point.y * element.height}`,
          )
          .join(" ") + " Z",
    )
    .join(" ") ?? "";
