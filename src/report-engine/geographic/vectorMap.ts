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
  regional?: boolean;
  waterLabels?: { name: string; longitude: number; latitude: number }[];
}
export function containsMapPoint(feature: MapFeature, point: Position): boolean {
  const ringContains = (ring: Position[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const polygons = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates
    : feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : [];
  return polygons.some(p => p[0] && ringContains(p[0]) && !p.slice(1).some(ringContains));
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
  const waterLabels = (input.waterLabels ?? []).map(label => {
    const position: Position = [label.longitude, label.latitude];
    if (!input.water.some(feature => containsMapPoint(feature, position)))
      throw new Error(`Water label is outside verified water geometry: ${label.name}`);
    const p = project(position);
    if (!inside(p)) throw new Error("Water label outside map frame");
    labelBoxes.push({ ...p, width: label.name.length * 5 });
    return `<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="10" font-style="italic" fill="#66838d">${escapeXml(label.name)}</text>`;
  }).join("");
  const labels = input.municipalities.flatMap(city => {
    const p = project([city.longitude, city.latitude]), width = city.name.length * 5;
    if (labelBoxes.length >= (input.regional ? 13 : 14) || p.x - width / 2 < 6 || p.x + width / 2 > input.width - 6 || p.y < 12 || p.y > input.height - 6 || labelBoxes.some(other => Math.abs(p.y - other.y) < 20 && Math.abs(p.x - other.x) < (width + other.width) / 2 + 8) ||
      placements.some(marker => Math.hypot(p.x - marker.label.x, p.y - marker.label.y) < width / 2 + 15)) return [];
    labelBoxes.push({ ...p, width });
    return [`<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="9" fill="#47535b" stroke="#f2f3f0" stroke-width="2" paint-order="stroke">${escapeXml(city.name)}</text>`];
  }).join("");
  const markers = placements.map((placement, index) => {
    const { anchor: a, label: p } = placement, marker = input.markers[index]!;
    if (!/^#[a-fA-F0-9]{6}$/.test(marker.color)) throw new Error("Invalid marker color");
    return `<path d="M${a.x},${a.y} L${p.x},${p.y}" stroke="${marker.color}" stroke-width="0.65"/><circle cx="${a.x}" cy="${a.y}" r="1.8" fill="${marker.color}"/><circle cx="${p.x}" cy="${p.y}" r="8" fill="${marker.color}" stroke="white" stroke-width="0.7"/><text x="${p.x}" y="${p.y + 2.6}" text-anchor="middle" font-size="7.5" font-weight="600" fill="white">${escapeXml(marker.code)}</text>`;
  }).join("");
  // Reuse each road path for its casing and centerline instead of duplicating thousands of objects.
  const roadDefinitions = (["local", "secondary", "primary"] as const).map(layer => {
    const batches: string[] = [];
    for (let offset = 0; offset < input[layer].length; offset += 500)
      batches.push(`<path d="${input[layer].slice(offset, offset + 500).map(feature => geometry(feature.geometry)).join(" ")}"/>`);
    return `<g id="roads-${layer}">${batches.join("")}</g>`;
  }).join("");
  const road = (layer: string, stroke: string, width: number) => `<use href="#roads-${layer}" fill="none" stroke="${stroke}" stroke-width="${width * (input.regional ? .65 : 1)}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}"><defs>${roadDefinitions}<clipPath id="map-frame"><rect width="${input.width}" height="${input.height}"/></clipPath></defs><g clip-path="url(#map-frame)" font-family="Nunito Sans, sans-serif"><rect width="${input.width}" height="${input.height}" fill="#f2f3f0"/>${paths(input.parks, "#e1e8db", "none", 0)}${paths(input.water, "#c0dce3", "none", 0)}${road("local", "#e2e4e3", .5)}${road("local", "white", .29)}${road("secondary", "white", 1.45)}${road("secondary", "#c7bca0", .48)}${road("primary", "white", 3.1)}${road("primary", "#788aa8", 1.35)}${paths([input.boundary], "#762c40", "none", 0, .045)}${paths([input.boundary], "none", "#762c40", 1)}${waterLabels}${labels}${markers}</g></svg>`;
  return { svg, placements };
}
