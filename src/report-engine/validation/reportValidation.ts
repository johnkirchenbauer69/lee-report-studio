import type { ReportTemplate } from "../../types/report";
import type {
  DatasetSection,
  IndustrialMarketReport,
  MarketMetrics,
} from "../schema/industrialMarketReport";
import { DATASET_SECTIONS } from "../schema/industrialMarketReport";
import type {
  ReportGenerationRequest,
  ReportProviderId,
  ReportReadiness,
} from "../schema/generation";

export type ValidationSeverity = "info" | "warning" | "error" | "blocking";

export interface ReportValidationIssue {
  path: string;
  message: string;
  level: ValidationSeverity;
  category: "data" | "provenance" | "readiness";
}

const metricKeys: (keyof MarketMetrics)[] = [
  "inventorySf",
  "deliveredSf",
  "underConstructionSf",
  "speculativeShare",
  "quarterlyNetAbsorptionSf",
  "vacancyRate",
  "availabilityRate",
  "askingNetRentPsf",
  "salesVolume",
];

const sectionLabels: Record<DatasetSection, string> = {
  overallMarket: "Overall market metrics",
  submarkets: "Submarket metrics",
  historicalPeriods: "Historical market indicators",
  leasing: "Top lease records",
  sales: "Top sales records",
  availabilities: "Top availabilities",
  deliveries: "Top deliveries",
  construction: "Construction highlights",
  narrative: "Market narrative",
};

const collectionSize = (
  report: IndustrialMarketReport,
  section: DatasetSection,
) => {
  if (section === "overallMarket") return report.submarkets.length ? 1 : 0;
  if (section === "narrative")
    return report.overallMarket.narrative.trim() ? 1 : 0;
  return report[section].length;
};

export function validateRequestConsistency(
  report: IndustrialMarketReport,
  request: ReportGenerationRequest,
): ReportValidationIssue[] {
  const issues: ReportValidationIssue[] = [];
  if (report.report.period !== request.period) {
    issues.push({
      path: "report.period",
      message: `Requested period ${request.period} does not match source period ${report.report.period}.`,
      level: "blocking",
      category: "data",
    });
  }
  if (report.report.market !== request.market) {
    issues.push({
      path: "report.market",
      message: `Requested market ${request.market} does not match source market ${report.report.market}.`,
      level: "blocking",
      category: "data",
    });
  }
  return issues;
}

export function validateNormalizedReport(
  report: IndustrialMarketReport,
  options: {
    provider?: ReportProviderId;
    requiredSections?: DatasetSection[];
    optionalSections?: DatasetSection[];
  } = {},
): ReportValidationIssue[] {
  const issues: ReportValidationIssue[] = [];
  const required = new Set(options.requiredSections ?? []);
  const optional = new Set(options.optionalSections ?? []);

  if (!report.submarkets.length) {
    issues.push({
      path: "submarkets",
      message: "At least one submarket is required.",
      level: "error",
      category: "data",
    });
  }

  report.submarkets.forEach((market, index) => {
    const prefix = `submarkets[${index}]`;
    if (market.inventorySf === 0) {
      issues.push({
        path: `${prefix}.inventorySf`,
        message: `${market.name} has zero inventory; weighted market rates exclude it.`,
        level:
          market.vacancyRate > 0 || market.availabilityRate > 0
            ? "warning"
            : "info",
        category: "data",
      });
    }
    if (market.availabilityRate < market.vacancyRate) {
      issues.push({
        path: `${prefix}.availabilityRate`,
        message: `${market.name} availability is below vacancy; verify the source definitions.`,
        level: "warning",
        category: "data",
      });
    }
    if (market.askingNetRentPsf === 0) {
      issues.push({
        path: `${prefix}.askingNetRentPsf`,
        message: `${market.name} asking rent is zero; confirm whether the value is genuinely unavailable.`,
        level: "warning",
        category: "data",
      });
    }
  });

  const completenessBySection = new Map(
    report.dataCompleteness.map((status) => [status.section, status]),
  );
  for (const section of DATASET_SECTIONS) {
    const declarations = report.dataCompleteness.filter(
      (item) => item.section === section,
    );
    if (declarations.length > 1) {
      issues.push({
        path: `dataCompleteness.${section}`,
        message: `${sectionLabels[section]} has duplicate completeness declarations.`,
        level: "blocking",
        category: "data",
      });
    }
    const status = completenessBySection.get(section);
    if (!status) {
      issues.push({
        path: `dataCompleteness.${section}`,
        message: `${sectionLabels[section]} has no completeness declaration.`,
        level: "blocking",
        category: "readiness",
      });
      continue;
    }
    const size = collectionSize(report, section);
    if (status.status === "complete" && size === 0) {
      issues.push({
        path: `dataCompleteness.${section}`,
        message: `${sectionLabels[section]} is marked complete but contains no supplied data.`,
        level: "blocking",
        category: "data",
      });
    }
    if (status.status === "complete" && !status.sourceIds.length) {
      issues.push({
        path: `dataCompleteness.${section}`,
        message: `${sectionLabels[section]} is marked complete without a source identifier.`,
        level: "blocking",
        category: "provenance",
      });
    }
    if (
      (status.status === "missing" || status.status === "not-requested") &&
      size > 0
    ) {
      issues.push({
        path: `dataCompleteness.${section}`,
        message: `${sectionLabels[section]} contains data but is marked ${status.status.replace("-", " ")}.`,
        level: "blocking",
        category: "data",
      });
    }
    if (status.status === "missing" || status.status === "partial") {
      const level: ValidationSeverity = required.has(section)
        ? "blocking"
        : optional.has(section)
          ? "warning"
          : "info";
      issues.push({
        path: `dataCompleteness.${section}`,
        message:
          `${sectionLabels[section]} is ${status.status.replace("-", " ")}. ${status.note ?? ""}`.trim(),
        level,
        category: "readiness",
      });
    }
  }

  if (options.provider && options.provider !== "sample") {
    report.submarkets.forEach((submarket) => {
      metricKeys.forEach((field) => {
        const fieldPath = `submarkets.${submarket.name}.${field}`;
        const lineage = report.provenance.find(
          (record) => record.fieldPath === fieldPath,
        );
        if (!lineage) {
          issues.push({
            path: fieldPath,
            message: `${submarket.name} — ${field} is missing imported-source provenance.`,
            level: "blocking",
            category: "provenance",
          });
          return;
        }
        const incompleteSource = lineage.sources.find(
          (source) => !source.reference || !source.importedAt,
        );
        if (incompleteSource) {
          issues.push({
            path: fieldPath,
            message: `${submarket.name} — ${field} provenance must include a source reference and import timestamp.`,
            level: "blocking",
            category: "provenance",
          });
        }
      });
    });
  }

  report.provenance
    .filter(
      (record) =>
        record.reconciliation &&
        record.reconciliation.classification !== "matched",
    )
    .forEach((record) =>
      issues.push({
        path: record.fieldPath,
        message: record.note ?? record.reconciliation!.reason,
        level:
          record.reconciliation!.classification === "blocking"
            ? "blocking"
            : "warning",
        category: "provenance",
      }),
    );

  report.provenance
    .filter((record) => record.status === "conflict" && !record.reconciliation)
    .forEach((record) =>
      issues.push({
        path: record.fieldPath,
        message:
          record.note ??
          "Authoritative sources disagree and remain unresolved.",
        level:
          record.critical || record.fieldPath.startsWith("overallMarket.")
            ? "blocking"
            : "warning",
        category: "provenance",
      }),
    );

  report.presentationOverrides.forEach((override) => {
    if (!override.reason.trim() || !override.authority.trim()) {
      issues.push({
        path: override.fieldPath,
        message: "Presentation overrides require a reason and authority.",
        level: "blocking",
        category: "provenance",
      });
    }
  });

  const leaseCollections = [
    { path: "leasing", leases: report.leasing },
    ...report.submarketDetails.map((detail, index) => ({
      path: `submarketDetails[${index}].leasing`,
      leases: detail.leasing,
    })),
  ];
  leaseCollections.forEach(({ path, leases }) =>
    leases.forEach((lease, index) => {
      if (
        lease.isDealConfidential !== true &&
        lease.isDealConfidential !== false
      )
        issues.push({
          path: `${path}[${index}].isDealConfidential`,
          message:
            "Included Lease confidentiality could not be verified; publication is blocked and its Tenant remains masked.",
          level: "blocking",
          category: "readiness",
        });
    }),
  );

  return issues;
}

export function evaluateReportReadiness(
  report: IndustrialMarketReport,
  template: ReportTemplate,
  provider: ReportProviderId,
): ReportReadiness {
  const issues = validateNormalizedReport(report, {
    provider,
    requiredSections: template.requiredSections,
    optionalSections: template.optionalSections,
  });
  const blockers = issues.filter(
    (issue) => issue.level === "blocking" || issue.level === "error",
  );
  return {
    canEdit: true,
    canExportDraft: !issues.some((issue) => issue.level === "error"),
    canApprove: blockers.length === 0,
    canPublish: blockers.length === 0,
    blockers,
    issues,
  };
}
