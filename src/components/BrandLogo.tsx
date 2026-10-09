import { useEffect } from "react";
import { brandAssets } from "../shared/brandAssets";
import type { Asset } from "../types/report";
import { isApprovedManagedFont } from "../services/fontGovernance";

// Load already licensed organization fonts for application chrome only.
// The private family name cannot change publication font selection.
export function useBrandTypography() {
  useEffect(() => {
    let stopped = false;
    void fetch("/api/assets")
      .then(async (response) => {
        if (!response.ok) return;
        const { assets } = (await response.json()) as { assets: Asset[] };
        const candidates = assets.filter(
          (a) =>
            a.type === "font" &&
            a.fontFamily === "Avenir Next LT Pro" &&
            a.fontWidthClass === 5 &&
            a.fontStyle === "normal" &&
            isApprovedManagedFont(a),
        );
        await Promise.all(
          candidates
            .filter((a) => [400, 600, 700].includes(a.fontWeight ?? 400))
            .map(async (a) => {
              try {
                const face = new FontFace(
                  "Lee Application Avenir",
                  `url("${a.source}")`,
                  {
                    weight: String(a.fontWeight ?? 400),
                    style: "normal",
                    display: "swap",
                  },
                );
                await face.load();
                if (!stopped) document.fonts.add(face);
              } catch {
                /* Approved Arial fallback remains available. */
              }
            }),
        );
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, []);
}
export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={compact ? "brand-logo compact" : "brand-logo"}
      src={compact ? brandAssets.icon : brandAssets.fullColor}
      alt="Lee & Associates"
      width={compact ? 308 : 856}
      height={compact ? 170 : 169}
    />
  );
}
