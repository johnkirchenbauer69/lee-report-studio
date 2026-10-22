import { createHash } from "node:crypto";
import type { StoredTemplateVersion } from "../../src/types/templateLibrary.ts";
import type { ReportTemplate } from "../../src/types/report.ts";
import { CANONICAL_TEMPLATES } from "../../src/report-engine/canonicalTemplates.ts";

export const APPROVED_CLASSIC_SOURCE = {
  id: "industrial-market-report", version: "1.20.0",
  checksum: "bf456b414ad754e288f08469a5253531981cd924441e212be0cbd49a44be12d1",
} as const;

/** Fork exact approved layout bytes; never rename or revise the historical family. */
export function classicFamilyTemplate(source: StoredTemplateVersion): ReportTemplate {
  const digest = createHash("sha256").update(JSON.stringify(source.template)).digest("hex");
  if (source.id !== APPROVED_CLASSIC_SOURCE.id || source.version !== APPROVED_CLASSIC_SOURCE.version ||
    source.checksum !== APPROVED_CLASSIC_SOURCE.checksum || digest !== APPROVED_CLASSIC_SOURCE.checksum)
    throw new Error("Classic source does not match approved Q3 v1.20.0. No template changed.");
  return { ...structuredClone(source.template), id: CANONICAL_TEMPLATES[0].id,
    name: CANONICAL_TEMPLATES[0].name, version: "1.0.0" };
}
