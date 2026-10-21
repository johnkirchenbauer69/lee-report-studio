/** Stable family identities; publication versions remain independently pinned. */
export const CANONICAL_TEMPLATES = [
  { id: "industrial-market-classic", name: "Industrial Market Report: Classic", shortName: "Classic",
    description: "Traditional 44-page industrial market research report." },
  { id: "industrial-market-geographic", name: "Industrial Market Report: Geographic", shortName: "Geographic",
    description: "Redesigned 44-page report with featured listings and geographic activity maps." },
] as const;

export function canonicalTemplate(id: string) {
  return CANONICAL_TEMPLATES.find((family) => family.id === id);
}
