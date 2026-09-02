import "dotenv/config";
import path from "node:path";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";

const families = new Set(
  (process.env.LEE_FONT_FAMILIES ?? "")
    .split(",")
    .map((family) => family.trim())
    .filter(Boolean),
);
const licenseType = process.env.LEE_FONT_LICENSE_TYPE?.trim();
const attestedBy = process.env.LEE_FONT_LICENSE_ATTESTED_BY?.trim();
const usageScope = process.env.LEE_FONT_LICENSE_USAGE_SCOPE?.trim();
if (!families.size || !licenseType || !attestedBy || !usageScope)
  throw new Error(
    "LEE_FONT_FAMILIES, LEE_FONT_LICENSE_TYPE, LEE_FONT_LICENSE_ATTESTED_BY, and LEE_FONT_LICENSE_USAGE_SCOPE are required.",
  );

const store = new FileSystemAssetStore(
  path.resolve(process.env.LEE_DATA_DIR ?? "server/data"),
);
await store.initialize();
const approved = await store.approveFontFamilies(families, {
  type: licenseType,
  attestedAt: new Date().toISOString(),
  attestedBy,
  usageScope,
});

console.log(
  JSON.stringify(
    {
      approvedFaces: approved.length,
      families: [...new Set(approved.map((asset) => asset.fontFamily))],
      weights: [...new Set(approved.map((asset) => asset.fontWeight))].sort(
        (left, right) => (left ?? 0) - (right ?? 0),
      ),
      styles: [...new Set(approved.map((asset) => asset.fontStyle))],
      widthClasses: [...new Set(approved.map((asset) => asset.fontWidthClass))],
      governanceStatus: "approved",
      license: approved[0]?.license,
    },
    null,
    2,
  ),
);
