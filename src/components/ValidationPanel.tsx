import type { DatasetSectionStatus } from "../report-engine/schema/industrialMarketReport";
import type { ValidationItem } from "../types/report";

const sectionLabels: Record<DatasetSectionStatus["section"], string> = {
  overallMarket: "Overall Market",
  submarkets: "Submarket Metrics",
  historicalPeriods: "Historical Indicators",
  leasing: "Top Leases",
  sales: "Top Sales",
  availabilities: "Availabilities",
  deliveries: "Deliveries",
  construction: "Construction",
  narrative: "Narrative",
};

const severityIcon = (level: ValidationItem["level"]) =>
  level === "ok" || level === "info" ? "✓" : level === "warning" ? "⚠" : "✕";

export function ValidationPanel({
  items,
  completeness,
  onSelect,
  onViewReconciliation,
}: {
  items: ValidationItem[];
  completeness?: DatasetSectionStatus[];
  onSelect?: (id: string) => void;
  onViewReconciliation?: (path: string) => void;
}) {
  const blockers = items.filter((item) => item.level === "blocking").length;
  const warnings = items.filter((item) => item.level === "warning").length;
  return (
    <div className="validation-panel">
      <div className="panel-heading">
        <div>
          <strong>Report QA</strong>
          <span>
            {blockers} blocking · {warnings} warnings
          </span>
        </div>
      </div>
      {completeness && (
        <section className="completeness-card">
          <strong>Data Completeness</strong>
          {completeness.map((item) => (
            <div key={item.section} className={item.status}>
              <span>
                {item.status === "complete"
                  ? "✓"
                  : item.status === "not-requested"
                    ? "—"
                    : "⚠"}
              </span>
              <em>{sectionLabels[item.section]}</em>
              <small>{item.status.replace("-", " ")}</small>
            </div>
          ))}
        </section>
      )}
      {items.map((item, index) => (
        <div
          className={`validation-row ${item.level}`}
          key={`${item.message}-${index}`}
        >
          <span>{severityIcon(item.level)}</span>
          <em>{item.message}</em>
          {item.elementId && (
            <button onClick={() => onSelect?.(item.elementId!)}>Select</button>
          )}
          {item.path?.startsWith("reconciliation.submarkets.") && (
            <button onClick={() => onViewReconciliation?.(item.path!)}>
              View reconciliation
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
