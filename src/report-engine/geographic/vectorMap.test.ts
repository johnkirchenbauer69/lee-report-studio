import { expect, it } from "vitest";
import { frameBounds, renderVectorMap, type VectorMapInput } from "./vectorMap";
const input: VectorMapInput = {
  width: 380, height: 582, bounds: [-88.3, 41.7, -87.9, 42],
  boundary: { geometry: { type: "Polygon", coordinates: [[[-88.2, 41.8], [-88, 41.8], [-88, 41.9], [-88.2, 41.8]]] } },
  primary: [], secondary: [], local: [], water: [], parks: [], municipalities: [],
  markers: [{ code: "L1", longitude: -88.1, latitude: 41.85, color: "#762c40" }],
};
it("produces vector-only content without changing source geometry or coordinates", () => {
  const before = structuredClone(input);
  const result = renderVectorMap(input);
  expect(result.svg).toContain("<path");
  expect(result.svg).not.toContain("<image");
  expect(input).toEqual(before);
  expect(result.placements).toHaveLength(1);
});
it("requires reframing for a property outside the viewport", () => {
  expect(() => renderVectorMap({ ...input, markers: [{ ...input.markers[0]!, longitude: -89 }] })).toThrow("expand the frame");
});
it("escapes municipality labels", () => {
  const result = renderVectorMap({ ...input, markers: [], municipalities: [{ name: "A&B <City>", longitude: -88.1, latitude: 41.85 }] });
  expect(result.svg).toContain("A&amp;B &lt;City&gt;");
});
it("captures context across the entire tall print frame while retaining the original extent", () => {
  const bounds = frameBounds(input.bounds, input.width, input.height);
  expect(bounds[0]).toBeLessThanOrEqual(input.bounds[0] + 1e-10);
  expect(bounds[1]).toBeLessThanOrEqual(input.bounds[1]);
  expect(bounds[2]).toBeGreaterThanOrEqual(input.bounds[2] - 1e-10);
  expect(bounds[3]).toBeGreaterThanOrEqual(input.bounds[3]);
  const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  expect((bounds[2] - bounds[0]) * Math.PI / 180 / (mercatorY(bounds[3]) - mercatorY(bounds[1])))
    .toBeCloseTo(input.width / input.height, 10);
});
