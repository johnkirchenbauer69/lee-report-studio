import { placeActivityLabels } from "./activity";

type Position = [number, number];
export type MapGeometry = { type: "LineString"; coordinates: Position[] } |
  { type: "MultiLineString" | "Polygon"; coordinates: Position[][] } |
  { type: "MultiPolygon"; coordinates: Position[][][] };
export interface MapFeature { geometry: MapGeometry; properties?: Record<string, unknown> }
export interface VectorMapInput {
  width: number; height: number;
  bounds: [number, number, number, number];
  boundary: MapFeature;
  primary: MapFeature[]; secondary: MapFeature[]; local: MapFeature[];
  water: MapFeature[]; parks: MapFeature[];
  municipalities: { name: string; longitude: number; latitude: number }[];
  markers: { code: string; longitude: number; latitude: number; color: string }[];
}
const escapeXml = (value: string) => value.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
const mercator = ([lon, lat]: Position): Position => [lon * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];

/** Expand the context capture extent to cover the entire print frame without distortion. */
export function frameBounds(bounds: [number, number, number, number], width: number, height: number): [number, number, number, number] {
  const lower = mercator([bounds[0], bounds[1]]), upper = mercator([bounds[2], bounds[3]]);
  const cx = (lower[0] + upper[0]) / 2, cy = (lower[1] + upper[1]) / 2;
  const scale = Math.max((upper[0] - lower[0]) / width, (upper[1] - lower[1]) / height);
  const latitude = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
  return [(cx - scale * width / 2) * 180 / Math.PI, latitude(cy - scale * height / 2),
    (cx + scale * width / 2) * 180 / Math.PI, latitude(cy + scale * height / 2)];
}

/** Independent Census-based Variant B renderer. No hosted map service or membership lookup. */
export function renderVectorMap(input: VectorMapInput) {
  const [west, south, east, north] = input.bounds;
  if (!(west < east && south < north && south > -85 && north < 85 && input.width > 0 && input.height > 0))
    throw new Error("Invalid map framing");
  const lower = mercator([west, south]), upper = mercator([east, north]);
  const scale = Math.min(input.width / (upper[0] - lower[0]), input.height / (upper[1] - lower[1]));
  const paddingX = (input.width - scale * (upper[0] - lower[0])) / 2;
  const paddingY = (input.height - scale * (upper[1] - lower[1])) / 2;
  const project = (position: Position) => {
    const p = mercator(position);
    return { x: paddingX + (p[0] - lower[0]) * scale, y: paddingY + (upper[1] - p[1]) * scale };
  };
  const line = (points: Position[], close = false) => points.map((p, i) => {
    const xy = project(p); return `${i ? "L" : "M"}${xy.x.toFixed(3)},${xy.y.toFixed(3)}`;
  }).join(" ") + (close ? " Z" : "");
  const geometry = (g: MapGeometry): string => {
    switch (g.type) {
      case "LineString": return line(g.coordinates);
      case "MultiLineString": return g.coordinates.map(p => line(p)).join(" ");
      case "Polygon": return g.coordinates.map(p => line(p, true)).join(" ");
      case "MultiPolygon": return g.coordinates.map(poly => poly.map(p => line(p, true)).join(" ")).join(" ");
    }
  };
  const paths = (features: MapFeature[], fill: string, stroke: string, width: number, opacity = 1) =>
    features.flatMap(f => f.geometry.type === "MultiPolygon"
      ? f.geometry.coordinates.map(coordinates => ({ geometry: { type: "Polygon" as const, coordinates } })) : [f])
      .map(f => `<path d="${geometry(f.geometry)}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`).join("");
  const inside = (point: { x: number; y: number }) => point.x >= 0 && point.x <= input.width && point.y >= 0 && point.y <= input.height;
  const anchors = input.markers.map(marker => {
    if (!Number.isFinite(marker.longitude) || !Number.isFinite(marker.latitude) || Math.abs(marker.latitude) >= 85)
      throw new Error(`Invalid property coordinates: ${marker.code}`);
    const anchor = { code: marker.code, ...project([marker.longitude, marker.latitude]) };
    if (!inside(anchor)) throw new Error(`Property outside map frame: ${marker.code}; expand the frame, never move the property.`);
    return anchor;
  });
  const placements = placeActivityLabels(anchors, { left: 10, top: 10, right: input.width - 10, bottom: input.height - 10 });
  const labelBoxes: { x: number; y: number; width: number }[] = [];
  const labels = input.municipalities.flatMap(city => {
    const p = project([city.longitude, city.latitude]), width = city.name.length * 5;
    if (labelBoxes.length >= 14 || p.x - width / 2 < 6 || p.x + width / 2 > input.width - 6 || p.y < 12 || p.y > input.height - 6 || labelBoxes.some(other => Math.abs(p.y - other.y) < 20 && Math.abs(p.x - other.x) < (width + other.width) / 2 + 8) ||
      placements.some(marker => Math.hypot(p.x - marker.label.x, p.y - marker.label.y) < width / 2 + 15)) return [];
    labelBoxes.push({ ...p, width });
    return [`<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="9" fill="#47535b" stroke="#f2f3f0" stroke-width="2" paint-order="stroke">${escapeXml(city.name)}</text>`];
  }).join("");
  const markers = placements.map((placement, index) => {
    const { anchor: a, label: p } = placement, marker = input.markers[index]!;
    if (!/^#[a-fA-F0-9]{6}$/.test(marker.color)) throw new Error("Invalid marker color");
    return `<path d="M${a.x},${a.y} L${p.x},${p.y}" stroke="${marker.color}" stroke-width="0.65"/><circle cx="${a.x}" cy="${a.y}" r="1.8" fill="${marker.color}"/><circle cx="${p.x}" cy="${p.y}" r="8" fill="${marker.color}" stroke="white" stroke-width="0.7"/><text x="${p.x}" y="${p.y + 2.6}" text-anchor="middle" font-size="7.5" font-weight="600" fill="white">${escapeXml(marker.code)}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}"><defs><clipPath id="map-frame"><rect width="${input.width}" height="${input.height}"/></clipPath></defs><g clip-path="url(#map-frame)" font-family="Nunito Sans, sans-serif"><rect width="${input.width}" height="${input.height}" fill="#f2f3f0"/>${paths(input.parks, "#e1e8db", "none", 0)}${paths(input.water, "#c0dce3", "none", 0)}${paths(input.local, "none", "#e2e4e3", .5)}${paths(input.local, "none", "white", .29)}${paths(input.secondary, "none", "white", 1.45)}${paths(input.secondary, "none", "#c7bca0", .48)}${paths(input.primary, "none", "white", 3.1)}${paths(input.primary, "none", "#788aa8", 1.35)}${paths([input.boundary], "#762c40", "none", 0, .045)}${paths([input.boundary], "none", "#762c40", 1)}${labels}${markers}</g></svg>`;
  return { svg, placements };
}
