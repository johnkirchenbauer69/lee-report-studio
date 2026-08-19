import {
  DATASET_SECTIONS,
  type DatasetSection,
  type DatasetSectionStatus,
  type IndustrialMarketReport,
} from "../report-engine/schema/industrialMarketReport";

const collectionSections = [
  "submarkets",
  "historicalPeriods",
  "leasing",
  "sales",
  "availabilities",
  "deliveries",
  "construction",
] as const;

export function inferCompleteness(
  report: Omit<IndustrialMarketReport, "dataCompleteness">,
  sourceId: string,
): DatasetSectionStatus[] {
  const statuses = new Map<DatasetSection, DatasetSectionStatus>();
  statuses.set("overallMarket", {
    section: "overallMarket",
    status: report.submarkets.length ? "complete" : "missing",
    sourceIds: report.submarkets.length ? [sourceId] : [],
  });
  for (const section of collectionSections) {
    const complete = report[section].length > 0;
    statuses.set(section, {
      section,
      status: complete ? "complete" : "missing",
      sourceIds: complete ? [sourceId] : [],
      note: complete ? undefined : "No records were supplied by this source.",
    });
  }
  const narrative = report.overallMarket.narrative.trim().length > 0;
  statuses.set("narrative", {
    section: "narrative",
    status: narrative ? "complete" : "missing",
    sourceIds: narrative ? [sourceId] : [],
    note: narrative ? undefined : "No narrative was supplied by this source.",
  });
  return DATASET_SECTIONS.map((section) => statuses.get(section)!);
}

export const completenessStatus = (
  completeness: DatasetSectionStatus[],
  section: DatasetSection,
) => completeness.find((item) => item.section === section);
