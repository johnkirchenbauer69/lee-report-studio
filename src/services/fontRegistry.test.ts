import { describe, expect, it } from "vitest";
import type { Asset } from "../types/report";
import { groupFontAssets, managedFontCss } from "./fontRegistry";

const face = (
  id: string,
  weight: number,
  style: "normal" | "italic",
): Asset => ({
  id,
  name: id,
  type: "font",
  mimeType: "font/ttf",
  source: `/fonts/${id}.ttf`,
  createdAt: "2026-01-01T00:00:00.000Z",
  fontFamily: "Nunito Sans",
  fontWeight: weight,
  fontStyle: style,
  checksum: id,
  storage: "backend",
});

describe("managed font registry", () => {
  it("groups all real faces into one family", () => {
    const groups = groupFontAssets([
      face("regular", 400, "normal"),
      face("bold", 700, "normal"),
      face("bold-italic", 700, "italic"),
    ]);
    expect(
      groups
        .get("Nunito Sans")
        ?.map((asset) => [asset.fontWeight, asset.fontStyle]),
    ).toEqual([
      [400, "normal"],
      [700, "normal"],
      [700, "italic"],
    ]);
  });

  it("emits centralized, no-synthesis font-face rules", () => {
    const css = managedFontCss([face("bold-italic", 700, "italic")]);
    expect(css).toContain('font-family:"Nunito Sans"');
    expect(css).toContain("font-weight:700");
    expect(css).toContain("font-style:italic");
    expect(css).toContain("font-display:block");
  });
});
