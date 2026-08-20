import type { ReportInstance } from "../report-engine/schema/generation";

interface Props {
  onBind: (path: string, format?: string) => void;
  reportInstance?: ReportInstance;
}
const fields = [
  ["report.title", "Report → Title", "text"],
  ["report.period", "Report → Period", "text"],
  ["overallMarket.inventorySf", "Overall Market → Inventory", "sf"],
  ["overallMarket.vacancyRate", "Overall Market → Vacancy", "percentage"],
  [
    "overallMarket.availabilityRate",
    "Overall Market → Availability",
    "percentage",
  ],
  [
    "overallMarket.quarterlyNetAbsorptionSf",
    "Overall Market → Quarterly Net Absorption",
    "sf",
  ],
  [
    "historicalPeriods[0].trailing12MonthNetAbsorptionSf",
    "Market Indicators → 12-Month Net Absorption",
    "sf",
  ],
  [
    "historicalPeriods[0].leasingActivitySf",
    "Overall Market → Leasing Activity",
    "sf",
  ],
  [
    "overallMarket.underConstructionSf",
    "Overall Market → Under Construction",
    "sf",
  ],
  ["market.name", "Current Market → Name", "text"],
  ["market.vacancyRate", "Current Market → Vacancy", "percentage"],
  ["market.availabilityRate", "Current Market → Availability", "percentage"],
  [
    "market.quarterlyNetAbsorptionSf",
    "Current Market → Quarterly Net Absorption",
    "sf",
  ],
];
export function DataBrowser({ onBind, reportInstance }: Props) {
  return (
    <div className="data-browser">
      <div className="panel-title">Connect Data</div>
      {reportInstance?.sourceSnapshotId && (
        <section
          className="snapshot-metadata"
          aria-label="Data snapshot metadata"
        >
          <strong>Data Snapshot</strong>
          <dl>
            <dt>ID</dt>
            <dd>{reportInstance.sourceSnapshotId}</dd>
            <dt>Generated</dt>
            <dd>
              {new Date(
                reportInstance.sourceMetadata.importedAt,
              ).toLocaleString()}
            </dd>
            <dt>Provider</dt>
            <dd>Ascendix / Salesforce</dd>
            <dt>Definition</dt>
            <dd>{reportInstance.reportDefinitionVersion}</dd>
            <dt>Hash</dt>
            <dd title={reportInstance.sourceSnapshotHash}>
              {reportInstance.sourceSnapshotHash?.slice(0, 12)}…
            </dd>
          </dl>
        </section>
      )}
      <p>Click a business field to bind it to the selected element.</p>
      {fields.map(([path, label, format]) => (
        <button key={path} onClick={() => onBind(path, format)}>
          <span>{label}</span>
          <code>{path}</code>
        </button>
      ))}
    </div>
  );
}
