import { createHash } from "node:crypto";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface InDesignTemplateRelease {
  familyId: string;
  templateVersion: string;
  templateChecksum: string;
  masterSha256: string;
  masterFormat?: "indd" | "json";
  derivedSha256?: string;
  scriptSha256: string;
  expectedPages: number;
}

/** Pure export input: no provider access, calculations or narrative generation. */
export function freezeInDesignExport(
  report: ReportInstance,
  release: InDesignTemplateRelease,
) {
  if (
    report.templateId !== release.familyId ||
    report.templateVersion !== release.templateVersion ||
    report.templateChecksum !== release.templateChecksum
  )
    throw new Error(
      "InDesign master does not match the report's pinned template release.",
    );
  if (
    report.pages.filter((page) => !page.hidden).length !== release.expectedPages
  )
    throw new Error("Report page count does not match the InDesign release.");
  if (!report.readiness.canExportDraft)
    throw new Error("Report is not ready for export.");
  for (const digest of [release.masterSha256, release.scriptSha256])
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new Error("InDesign release requires verified content hashes.");
  const snapshot = structuredClone(report);
  const manifest = {
    schemaVersion: 1,
    reportId: report.id,
    reportRevision: report.revision,
    reportSha256: hash(snapshot),
    release: structuredClone(release),
  };
  return { jobKey: hash(manifest), manifest, snapshot };
}

export interface InDesignValidation {
  pageCount: number;
  missingLinks: number;
  substitutedFonts: number;
  oversetFrames: number;
  oversetCells: number;
  nativeTextFrames: number;
  nativeTables: number;
  reopened: boolean;
  relocated: boolean;
  qaPdfPages: number;
  idmlImportValidated: boolean;
}

/** Provider success is not package acceptance; these checks precede download publication. */
export function validateInDesignPackage(
  result: InDesignValidation,
  expectedPages: number,
) {
  const failures: string[] = [];
  if (result.pageCount !== expectedPages || result.qaPdfPages !== expectedPages)
    failures.push("Incorrect document or PDF page count");
  for (const field of [
    "missingLinks",
    "substitutedFonts",
    "oversetFrames",
    "oversetCells",
  ] as const)
    if (result[field] !== 0) failures.push(`${field}: ${result[field]}`);
  if (!(result.nativeTextFrames > 0) || !(result.nativeTables > 0))
    failures.push("Native editability not demonstrated");
  if (!result.reopened || !result.relocated)
    failures.push("Save/reopen and relocation checks required");
  return {
    accepted: failures.length === 0,
    failures,
    includeIdml: failures.length === 0 && result.idmlImportValidated === true,
  };
}
