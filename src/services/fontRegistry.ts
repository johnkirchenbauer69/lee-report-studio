import type { Asset, Typography } from "../types/report";

const STYLE_ID = "lee-managed-font-faces";
export const BRAND_FONT_FAMILY = "Nunito Sans";

export const BUILTIN_FONT_FAMILIES = [
  {
    family: "Inter",
    css: "Inter, Arial, sans-serif",
    weights: [300, 400, 500, 600, 700, 800],
    styles: ["normal", "italic"] as const,
  },
  {
    family: "Arial",
    css: "Arial, sans-serif",
    weights: [400, 700],
    styles: ["normal", "italic"] as const,
  },
  {
    family: "Georgia",
    css: "Georgia, serif",
    weights: [400, 700],
    styles: ["normal", "italic"] as const,
  },
  {
    family: "Times New Roman",
    css: '"Times New Roman", Times, serif',
    weights: [400, 700],
    styles: ["normal", "italic"] as const,
  },
  {
    family: "Courier New",
    css: '"Courier New", monospace',
    weights: [400, 700],
    styles: ["normal", "italic"] as const,
  },
];

const safeCssValue = (value: string) => value.replace(/[\"\n\r]/g, "");
const cleanFamily = (value: string) =>
  value.trim().replace(/^['\"]|['\"]$/g, "");

/** Converts legacy CSS stacks into the single semantic family shown in the editor. */
export function normalizeSemanticFontFamily(value?: string): string {
  if (!value?.trim()) return BRAND_FONT_FAMILY;
  const families = value.split(",").map(cleanFamily).filter(Boolean);
  const normalized = families.map((family) => family.toLocaleLowerCase());
  if (normalized.includes("nunito sans")) return BRAND_FONT_FAMILY;
  const builtin = BUILTIN_FONT_FAMILIES.find((candidate) =>
    normalized.includes(candidate.family.toLocaleLowerCase()),
  );
  return builtin?.family ?? families[0] ?? BRAND_FONT_FAMILY;
}

/** Internal CSS stack; the Inspector never exposes this implementation detail. */
export const managedFontAssetFamily = (assetId: string) =>
  `LEE Managed ${assetId.replace(/[^a-z0-9-]/gi, "")}`;

export function fontFamilyToCss(family?: string, assetId?: string): string {
  const semantic = normalizeSemanticFontFamily(family);
  const semanticStack =
    semantic === BRAND_FONT_FAMILY
      ? '"Nunito Sans", Arial, sans-serif'
      : (BUILTIN_FONT_FAMILIES.find(
          (candidate) => candidate.family === semantic,
        )?.css ?? `"${safeCssValue(semantic)}", Arial, sans-serif`);
  return assetId
    ? `"${safeCssValue(managedFontAssetFamily(assetId))}", ${semanticStack}`
    : semanticStack;
}

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
    .map((asset) => {
      const source = `src:url("${safeCssValue(asset.source)}")`;
      const descriptors = `font-weight:${asset.fontWeight ?? 400};font-style:${asset.fontStyle ?? "normal"};font-display:block;`;
      const semantic = safeCssValue(
        normalizeSemanticFontFamily(asset.fontFamily),
      );
      const exact = safeCssValue(managedFontAssetFamily(asset.id));
      return `@font-face{font-family:"${exact}";${source};${descriptors}}\n@font-face{font-family:"${semantic}";${source};${descriptors}}`;
    })
    .join("\n");
}

export interface ManagedFontFaceDiagnostic {
  assetId: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
  checksum?: string;
  version?: number;
  license?: Asset["license"];
  loaded: boolean;
  message: string;
}

export async function installManagedFonts(
  assets: Asset[],
): Promise<ManagedFontFaceDiagnostic[]> {
  const fonts = assets.filter(
    (asset) => asset.type === "font" && asset.fontFamily && asset.source,
  );
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  style.textContent = managedFontCss(fonts);
  return Promise.all(
    fonts.map(async (asset): Promise<ManagedFontFaceDiagnostic> => {
      const family = normalizeSemanticFontFamily(asset.fontFamily);
      const weight = asset.fontWeight ?? 400;
      const fontStyle = asset.fontStyle ?? "normal";
      const descriptor = `${fontStyle} ${weight} 12px "${safeCssValue(managedFontAssetFamily(asset.id))}"`;
      try {
        const loadedFaces = await document.fonts.load(
          descriptor,
          "LEE managed font verification",
        );
        await document.fonts.ready;
        const loaded =
          loadedFaces.some((face) => face.status === "loaded") &&
          document.fonts.check(descriptor, "LEE managed font verification");
        return {
          assetId: asset.id,
          family,
          weight,
          style: fontStyle,
          checksum: asset.checksum,
          version: asset.version,
          license: asset.license,
          loaded,
          message: loaded
            ? "Managed face loaded and verified by document.fonts."
            : "Managed face unavailable; browser fallback is active.",
        };
      } catch (error) {
        return {
          assetId: asset.id,
          family,
          weight,
          style: fontStyle,
          checksum: asset.checksum,
          version: asset.version,
          license: asset.license,
          loaded: false,
          message: `Managed face unavailable; browser fallback is active (${error instanceof Error ? error.message : "load failed"}).`,
        };
      }
    }),
  );
}

export function groupFontAssets(assets: Asset[]) {
  const groups = new Map<string, Asset[]>();
  for (const asset of assets.filter(
    (item) => item.type === "font" && item.fontFamily,
  )) {
    const family = normalizeSemanticFontFamily(asset.fontFamily);
    const current = groups.get(family) ?? [];
    current.push(asset);
    groups.set(family, current);
  }
  return groups;
}

export function resolveManagedFontFace(
  assets: Asset[],
  family: string,
  weight: number,
  style: "normal" | "italic",
): Asset | undefined {
  const semantic = normalizeSemanticFontFamily(family);
  return assets.find(
    (asset) =>
      asset.type === "font" &&
      normalizeSemanticFontFamily(asset.fontFamily) === semantic &&
      (asset.fontWeight ?? 400) === weight &&
      (asset.fontStyle ?? "normal") === style,
  );
}

/** Resolves an exact face or the nearest real managed face, preferring the requested style. */
export function resolveAvailableManagedFontFace(
  assets: Asset[],
  family: string,
  weight: number,
  style: "normal" | "italic",
): Asset | undefined {
  const exact = resolveManagedFontFace(assets, family, weight, style);
  if (exact) return exact;
  const semantic = normalizeSemanticFontFamily(family);
  return assets
    .filter(
      (asset) =>
        asset.type === "font" &&
        normalizeSemanticFontFamily(asset.fontFamily) === semantic,
    )
    .sort((left, right) => {
      const leftScore =
        ((left.fontStyle ?? "normal") === style ? 0 : 10_000) +
        Math.abs((left.fontWeight ?? 400) - weight);
      const rightScore =
        ((right.fontStyle ?? "normal") === style ? 0 : 10_000) +
        Math.abs((right.fontWeight ?? 400) - weight);
      return (
        leftScore - rightScore ||
        (left.fontWeight ?? 400) - (right.fontWeight ?? 400)
      );
    })[0];
}

export function diagnoseFontSelection(
  typography: Pick<
    Typography,
    | "fontFamily"
    | "fontWeight"
    | "fontStyle"
    | "italic"
    | "fontAssetId"
    | "fontChecksum"
  >,
  assets: Asset[],
  diagnostics: ManagedFontFaceDiagnostic[],
) {
  const family = normalizeSemanticFontFamily(typography.fontFamily);
  const weight = Number(typography.fontWeight) || 400;
  const style =
    typography.fontStyle ?? (typography.italic ? "italic" : "normal");
  const managedFamily =
    groupFontAssets(assets).has(family) || family === BRAND_FONT_FAMILY;
  if (!managedFamily)
    return {
      family,
      weight,
      style,
      managed: false,
      loaded: true,
      message: "System font",
    };
  const face = typography.fontAssetId
    ? assets.find((asset) => asset.id === typography.fontAssetId)
    : resolveManagedFontFace(assets, family, weight, style);
  if (
    !face ||
    !face.checksum ||
    (typography.fontChecksum && face.checksum !== typography.fontChecksum)
  )
    return {
      family,
      weight,
      style,
      managed: true,
      loaded: false,
      message: "Managed face unavailable · Browser fallback active",
    };
  const status = diagnostics.find((item) => item.assetId === face.id);
  return {
    family,
    weight,
    style,
    managed: true,
    loaded: status?.loaded === true,
    assetId: face.id,
    checksum: face.checksum,
    message: status?.loaded
      ? "Managed · Loaded ✓"
      : "Managed face unavailable · Browser fallback active ⚠",
  };
}
