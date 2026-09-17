import { describe, expect, it } from "vitest";
import { validatePage } from "./validation";
import type { ImageElement, ReportPage, TextElement } from "../types/report";

/**
 * Regression coverage for the QA "None to Report" false-positive fix.
 *
 * `buildPresentationModel`'s `presentProperties` helper (see
 * src/report-engine/bindings/presentationModel.ts) always pads a property
 * highlight repeater (topAvailabilities / topDeliveries / topConstruction)
 * to exactly 3 slots and marks each slot's resolved state:
 *   - "record": a real qualifying record
 *   - "image-unavailable": a real record whose image genuinely could not be
 *     resolved
 *   - "none": a nonexistent slot (zero qualifying records, or an index past
 *     the actual record count)
 * These tests build minimal presentation-shaped data by hand to exercise
 * validatePage against each state directly.
 */

const imageEl = (id: string, path: string): ImageElement => ({
  id,
  type: "image",
  name: id,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  src: "",
  style: {},
  binding: { path },
});

const textEl = (id: string, path: string): TextElement => ({
  id,
  type: "text",
  name: id,
  x: 0,
  y: 0,
  width: 200,
  height: 20,
  text: "",
  style: {},
  binding: { path },
});

const page = (elements: ReportPage["elements"]): ReportPage => ({
  id: "p",
  name: "Page",
  width: 816,
  height: 1056,
  background: "#fff",
  elements,
});

const noneSlot = { address: "", sizeSf: 0, type: "", sponsor: "", image: "", state: "none", detail: "" };
const recordSlot = (overrides: Record<string, unknown> = {}) => ({
  address: "123 Main St",
  sizeSf: 100000,
  type: "Warehouse",
  sponsor: "Acme Developer",
  image: "https://cdn.example.com/img.jpg",
  state: "record",
  detail: "100,000 SF - Warehouse - Acme Developer",
  ...overrides,
});

describe("QA validation and None to Report slots", () => {
  it("zero deliveries: none_to_report produces no child address/detail/image warnings", () => {
    const data = { market: { topDeliveries: [noneSlot, noneSlot, noneSlot] } };
    const issues = validatePage(
      page([
        imageEl("delivery-image-0", "market.topDeliveries[0].image"),
        textEl("delivery-address-0", "market.topDeliveries[0].address"),
        textEl("delivery-detail-0", "market.topDeliveries[0].detail"),
      ]),
      data,
    );
    expect(issues.filter((i) => i.level !== "ok")).toEqual([]);
  });

  it("zero construction projects: no synthetic [0..2] missing-field warnings", () => {
    const data = { market: { topConstruction: [noneSlot, noneSlot, noneSlot] } };
    const issues = validatePage(
      page([0, 1, 2].flatMap((i) => [
        imageEl(`construction-image-${i}`, `market.topConstruction[${i}].image`),
        textEl(`construction-address-${i}`, `market.topConstruction[${i}].address`),
      ])),
      data,
    );
    expect(issues.filter((i) => i.level !== "ok")).toEqual([]);
  });

  it("one construction project: validates [0], never validates nonexistent [1]/[2]", () => {
    const data = { market: { topConstruction: [recordSlot(), noneSlot, noneSlot] } };
    const issues = validatePage(
      page([0, 1, 2].flatMap((i) => [
        imageEl(`construction-image-${i}`, `market.topConstruction[${i}].image`),
        textEl(`construction-address-${i}`, `market.topConstruction[${i}].address`),
      ])),
      data,
    );
    expect(issues.filter((i) => i.level !== "ok")).toEqual([]);
  });

  it("real project with a missing required image still warns", () => {
    const data = {
      market: { topConstruction: [recordSlot({ image: "", state: "image-unavailable" }), noneSlot, noneSlot] },
    };
    const issues = validatePage(
      page([imageEl("construction-image-0", "market.topConstruction[0].image")]),
      data,
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "error", message: "construction-image-0 is missing an image" }),
    );
  });

  it("an actual unresolved query/data state still warns", () => {
    // No `.state` sibling at all (not a card repeater) — an ordinary
    // missing-value binding must still be flagged.
    const issues = validatePage(
      page([textEl("overall-narrative", "market.narrative")]),
      { market: {} },
    );
    expect(issues.some((i) => i.level === "warning" && i.message.includes("Missing data"))).toBe(true);
  });

  it("none_to_report does not increase the QA warning count versus an empty page", () => {
    const emptyPageIssues = validatePage(page([]), {}).filter((i) => i.level !== "ok");
    const data = { market: { topDeliveries: [noneSlot, noneSlot, noneSlot] } };
    const noneToReportIssues = validatePage(
      page([
        imageEl("delivery-image-0", "market.topDeliveries[0].image"),
        textEl("delivery-address-0", "market.topDeliveries[0].address"),
      ]),
      data,
    ).filter((i) => i.level !== "ok");
    expect(noneToReportIssues.length).toBe(emptyPageIssues.length);
  });
});
