import type { Asset } from "../types/report";

const STYLE_ID = "lee-managed-font-faces";

export const BUILTIN_FONT_FAMILIES = [
  {
    family: "Inter",
    weights: [300, 400, 500, 600, 700, 800],
    styles: ["normal", "italic"] as const,
  },
  {
    family: "Arial",
    weights: [400, 700],
    styles: ["normal", "italic"] as const,
  },
  {
    family: "Georgia",
    weights: [400, 700],
    styles: ["normal", "italic"] as const,
  },
  {
    family: "Times New Roman",
    weights: [400, 700],
    styles: ["normal", "italic"] as const,
  },
  {
    family: "Courier New",
    weights: [400, 700],
    styles: ["normal", "italic"] as const,
  },
];

const safeCssValue = (value: string) => value.replace(/[\\"\n\r]/g, "");

export function managedFontCss(assets: Asset[]): string {
  return assets
    .filter(
      (asset) => asset.type === "font" && asset.fontFamily && asset.source,
    )
    .sort((a, b) =>
      `${a.fontFamily}-${a.fontWeight}-${a.fontStyle}`.localeCompare(
        `${b.fontFamily}-${b.fontWeight}-${b.fontStyle}`,
      ),
    )
    .map(
      (asset) =>
        `@font-face{font-family:"${safeCssValue(asset.fontFamily!)}";src:url("${safeCssValue(asset.source)}");font-weight:${asset.fontWeight ?? 400};font-style:${asset.fontStyle ?? "normal"};font-display:block;}`,
    )
    .join("\n");
}

export async function installManagedFonts(assets: Asset[]): Promise<void> {
  const fonts = assets.filter(
    (asset) => asset.type === "font" && asset.fontFamily,
  );
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  style.textContent = managedFontCss(fonts);
  await Promise.all(
    fonts.map((asset) =>
      document.fonts.load(
        `${asset.fontStyle ?? "normal"} ${asset.fontWeight ?? 400} 12px "${safeCssValue(asset.fontFamily!)}"`,
      ),
    ),
  );
  await document.fonts.ready;
}

export function groupFontAssets(assets: Asset[]) {
  const groups = new Map<string, Asset[]>();
  for (const asset of assets.filter(
    (item) => item.type === "font" && item.fontFamily,
  )) {
    const current = groups.get(asset.fontFamily!) ?? [];
    current.push(asset);
    groups.set(asset.fontFamily!, current);
  }
  return groups;
}
