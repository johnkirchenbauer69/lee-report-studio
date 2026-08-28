import type {
  Asset,
  FontGovernanceStatus,
  FontReference,
  ReportTemplate,
} from "../types/report";

const APPROVED_LICENSES = new Set([
  "sil open font license 1.1",
  "ubuntu font licence 1.0",
  "apache license 2.0",
]);

const restrictedLicenseEvidence = (asset: Asset) =>
  `${asset.license?.type ?? ""} ${asset.license?.fileName ?? ""}`
    .toLocaleLowerCase()
    .match(/personal[ _-]*use|noncommercial|non-commercial|restricted/);

export function inferFontGovernanceStatus(asset: Asset): FontGovernanceStatus {
  if (asset.type !== "font") return "approved";
  if (asset.fontGovernanceStatus) return asset.fontGovernanceStatus;
  const license = asset.license?.type?.trim().toLocaleLowerCase();
  if (license && APPROVED_LICENSES.has(license)) return "approved";
  return restrictedLicenseEvidence(asset) ? "restricted" : "unverified";
}

export const isApprovedManagedFont = (asset: Asset) =>
  asset.type === "font" && inferFontGovernanceStatus(asset) === "approved";

export const approvedManagedFontAssets = (assets: Asset[]) =>
  assets.filter(isApprovedManagedFont);

/** Collects only faces actually pinned in editable content, not every library asset. */
export function collectManagedFontReferences(
  template: ReportTemplate,
): FontReference[] {
  const assets = new Map(
    (template.assets ?? [])
      .filter((asset) => asset.type === "font")
      .map((asset) => [asset.id, asset]),
  );
  const references = new Map<string, FontReference>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.fontAssetId === "string") {
      const asset = assets.get(candidate.fontAssetId);
      if (
        asset?.fontFamily &&
        asset.fontWeight != null &&
        asset.fontStyle &&
        asset.checksum
      )
        references.set(asset.id, {
          assetId: asset.id,
          family: asset.fontFamily,
          weight: asset.fontWeight,
          style: asset.fontStyle,
          checksum: asset.checksum,
        });
    }
    Object.values(candidate).forEach(visit);
  };
  template.pages.forEach(visit);
  return [...references.values()];
}

export interface NonApprovedFontUsage {
  pageId: string;
  elementId: string;
  elementName: string;
  family: string;
  assetId?: string;
  status: Exclude<FontGovernanceStatus, "approved">;
}

/** Finds pinned disallowed faces and semantic families backed only by disallowed faces. */
export function findNonApprovedFontUsages(
  template: ReportTemplate,
): NonApprovedFontUsage[] {
  const fontAssets = (template.assets ?? []).filter(
    (asset) => asset.type === "font" && asset.fontFamily,
  );
  const byId = new Map(fontAssets.map((asset) => [asset.id, asset]));
  const usages = new Map<string, NonApprovedFontUsage>();
  for (const page of template.pages) {
    for (const element of page.elements) {
      const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const candidate = value as Record<string, unknown>;
        const pinnedAssetId =
          typeof candidate.fontAssetId === "string"
            ? candidate.fontAssetId
            : undefined;
        const pinned =
          pinnedAssetId != null ? byId.get(pinnedAssetId) : undefined;
        const family =
          pinned?.fontFamily ??
          (typeof candidate.fontFamily === "string"
            ? candidate.fontFamily.split(",")[0]!.replace(/[\"']/g, "").trim()
            : undefined);
        const familyAssets = family
          ? fontAssets.filter(
              (asset) =>
                asset.fontFamily?.toLocaleLowerCase() ===
                family.toLocaleLowerCase(),
            )
          : [];
        const disallowed = pinned
          ? inferFontGovernanceStatus(pinned) !== "approved"
            ? pinned
            : undefined
          : familyAssets.length && !familyAssets.some(isApprovedManagedFont)
            ? familyAssets[0]
            : undefined;
        if (pinnedAssetId && !pinned && family) {
          usages.set(`${page.id}:${element.id}:${pinnedAssetId}`, {
            pageId: page.id,
            elementId: element.id,
            elementName: element.name,
            family,
            assetId: pinnedAssetId,
            status: "unverified",
          });
        }
        if (disallowed && family) {
          const status = inferFontGovernanceStatus(disallowed);
          if (status !== "approved")
            usages.set(`${page.id}:${element.id}:${disallowed.id}`, {
              pageId: page.id,
              elementId: element.id,
              elementName: element.name,
              family,
              assetId: pinnedAssetId,
              status,
            });
        }
        Object.values(candidate).forEach(visit);
      };
      visit(element);
    }
  }
  return [...usages.values()];
}
