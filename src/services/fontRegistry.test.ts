import { describe, expect, it } from "vitest";
import type { Asset } from "../types/report";
import {
  diagnoseFontSelection,
  fontFamilyToCss,
  groupFontAssets,
  managedFontCss,
  normalizeSemanticFontFamily,
  resolveAvailableManagedFontFace,
  resolveManagedFontFace,
} from "./fontRegistry";

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

  it("normalizes legacy CSS stacks to one semantic brand family", () => {
    expect(normalizeSemanticFontFamily("Nunito Sans, Arial, sans-serif")).toBe(
      "Nunito Sans",
    );
    expect(
      normalizeSemanticFontFamily('"Nunito Sans", Arial, sans-serif'),
    ).toBe("Nunito Sans");
    expect(
      normalizeSemanticFontFamily(
        "Avenir Next, Nunito Sans, Arial, sans-serif",
      ),
    ).toBe("Nunito Sans");
    expect(fontFamilyToCss("Nunito Sans")).toBe(
      '"Nunito Sans", Arial, sans-serif',
    );
  });

  it("resolves only real managed weight and style combinations", () => {
    const assets = [
      face("regular", 400, "normal"),
      face("bold-italic", 700, "italic"),
    ];
    expect(
      resolveManagedFontFace(assets, "Nunito Sans", 400, "normal")?.id,
    ).toBe("regular");
    expect(
      resolveManagedFontFace(assets, "Nunito Sans", 400, "italic"),
    ).toBeUndefined();
  });

  it("migrates unsupported legacy weights to the nearest real face", () => {
    expect(
      resolveAvailableManagedFontFace(
        [face("light", 300, "normal")],
        "Nunito Sans",
        200,
        "normal",
      )?.id,
    ).toBe("light");
  });

  it("never treats a missing or unloaded managed face as success", () => {
    expect(
      diagnoseFontSelection(
        {
          fontFamily: "Nunito Sans",
          fontWeight: 400,
          fontStyle: "normal",
          italic: false,
        },
        [],
        [],
      ),
    ).toMatchObject({ managed: true, loaded: false });
    const regular = face("regular", 400, "normal");
    expect(
      diagnoseFontSelection(
        {
          fontFamily: "Nunito Sans",
          fontWeight: 400,
          fontStyle: "normal",
          italic: false,
          fontAssetId: regular.id,
          fontChecksum: regular.checksum,
        },
        [regular],
        [
          {
            assetId: regular.id,
            family: "Nunito Sans",
            weight: 400,
            style: "normal",
            checksum: regular.checksum,
            loaded: true,
            message: "loaded",
          },
        ],
      ),
    ).toMatchObject({ managed: true, loaded: true });
  });
});
