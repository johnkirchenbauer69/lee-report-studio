import type { ValidationItem } from "../../types/report";
import type { ExportPreflightIssue } from "./exportPreflight";

export interface ExportQaAssessment {
  blockers: ValidationItem[];
  warnings: ValidationItem[];
}

/**
 * PDF QA is deliberately separate from report approval readiness. Data,
 * narrative, layout, and styling findings remain visible, but only technical
 * preflight errors that make a correct PDF impossible stop rendering.
 */
export function assessExportQa(
  preflight: ExportPreflightIssue[],
  advisory: ValidationItem[] = [],
): ExportQaAssessment {
  const blockers = preflight
    .filter((issue) => issue.level === "error")
    .map(toValidationItem);
  const warnings = [
    ...preflight
      .filter((issue) => issue.level === "warning")
      .map(toValidationItem),
    ...advisory
      .filter((issue) => issue.level !== "ok" && issue.level !== "info")
      .map((issue) => ({ ...issue, level: "warning" as const })),
  ];
  return {
    blockers: deduplicate(blockers),
    warnings: deduplicate(warnings),
  };
}

export const asExportAdvisory = (issue: ValidationItem): ValidationItem => ({
  ...issue,
  level:
    issue.level === "ok" || issue.level === "info" ? issue.level : "warning",
});

const toValidationItem = (issue: ExportPreflightIssue): ValidationItem => ({
  level: issue.level,
  category: "export",
  message: issue.message,
  elementId: issue.elementId,
  pageId: issue.pageId,
});

const deduplicate = (issues: ValidationItem[]) =>
  issues.filter(
    (issue, index) =>
      issues.findIndex(
        (candidate) =>
          candidate.message === issue.message &&
          candidate.elementId === issue.elementId &&
          candidate.pageId === issue.pageId &&
          candidate.path === issue.path,
      ) === index,
  );
