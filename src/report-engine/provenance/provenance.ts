import type { IndustrialMarketReport, PresentationOverride, ProvenanceRecord } from '../schema/industrialMarketReport';

export function findProvenance(report: IndustrialMarketReport, fieldPath: string): ProvenanceRecord | undefined {
  return report.provenance.find(record => record.fieldPath === fieldPath);
}

export function findPresentationOverride(report: IndustrialMarketReport, fieldPath: string): PresentationOverride | undefined {
  return report.presentationOverrides.find(override => override.fieldPath === fieldPath);
}

export function resolvePresentationValue<T>(report: IndustrialMarketReport, fieldPath: string, normalizedValue: T): T {
  const override = findPresentationOverride(report, fieldPath);
  return (override ? override.value : normalizedValue) as T;
}

