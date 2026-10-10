import { displayAssetName } from "../shared/assetNames";
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
  onSelect?: (id: string, pageId?: string) => void;
  onViewReconciliation?: (path: string) => void;
}) {
  const blockingItems = items.filter(
    (item) => item.level === "blocking" || item.level === "error",
  );
  const warningItems = items.filter((item) => item.level === "warning");
  const informationalItems = items.filter(
    (item) => item.level === "ok" || item.level === "info",
  );
  const renderItems = (group: ValidationItem[]) =>
    group.map((item, index) => (
      <div
        className={`validation-row ${item.level}`}
        key={`${item.message}-${index}`}
      >
        <span>{severityIcon(item.level)}</span>
        <em>{displayAssetName(item.message)}{item.pageId && <small className="qa-page-label"> · Page {item.pageId}</small>}{item.elementId && <small> · Review placement or approved page bleed</small>}</em>
        {item.elementId && (
          <button onClick={() => onSelect?.(item.elementId!, item.pageId)}>
            Select
          </button>
        )}
        {item.path?.startsWith("reconciliation.submarkets.") && (
          <button onClick={() => onViewReconciliation?.(item.path!)}>
            View reconciliation
          </button>
        )}
      </div>
    ));
  return (
    <div className="validation-panel">
      <div className="panel-heading">
        <div>
          <strong>Report QA</strong>
          <span>
            {blockingItems.length} blocking · {warningItems.length} warnings
          </span>
        </div>
      </div>
      <p className="validation-empty">Document checks update as you edit. Full PDF export preflight additionally checks fonts, images and report data.</p>
      {items.length === 0 && (
        <p className="validation-empty" role="status">
          No issues found in the current page checks. Export PDF also checks
          required fonts, images, and report data before creating the file.
        </p>
      )}
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
      {blockingItems.length > 0 && (
        <section className="validation-group blocking-group">
          <strong>Blocking issues</strong>
          {renderItems(blockingItems)}
        </section>
      )}
      {warningItems.length > 0 && (
        <section className="validation-group warning-group">
          <strong>Warnings</strong>
          {renderItems(warningItems)}
        </section>
      )}
      {informationalItems.length > 0 && (
        <section className="validation-group informational-group">
          <strong>Passed checks and information</strong>
          {renderItems(informationalItems)}
        </section>
      )}
    </div>
  );
}
