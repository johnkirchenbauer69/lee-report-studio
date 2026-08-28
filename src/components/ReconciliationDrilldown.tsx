import type { ProvenanceRecord } from "../report-engine/schema/industrialMarketReport";

const sf = (value: number | null) =>
  value == null
    ? "Unavailable"
    : `${Math.round(value).toLocaleString("en-US")} SF`;
const pct = (value: number | null) =>
  value == null ? "Unavailable" : `${(value * 100).toFixed(4)}%`;

export function ReconciliationDrilldown({
  record,
  onClose,
}: {
  record: ProvenanceRecord;
  onClose: () => void;
}) {
  const reconciliation = record.reconciliation!;
  const details = reconciliation.details;
  const submarket = record.fieldPath.split(".")[2] ?? "Submarket";
  return (
    <div className="wizard-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="reconciliation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${submarket} inventory reconciliation`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">INVENTORY RECONCILIATION</span>
            <h2>{submarket}</h2>
            <p>{reconciliation.reason}</p>
          </div>
          <button aria-label="Close reconciliation" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="reconciliation-summary">
          <div>
            <span>Authoritative Market_Data</span>
            <strong>{sf(reconciliation.authoritativeValue)}</strong>
          </div>
          <div>
            <span>Property_Data aggregation</span>
            <strong>{sf(reconciliation.comparisonValue)}</strong>
          </div>
          <div>
            <span>Absolute variance</span>
            <strong>{sf(reconciliation.varianceAbsolute)}</strong>
          </div>
          <div>
            <span>Percentage variance</span>
            <strong>{pct(reconciliation.variancePercentage)}</strong>
          </div>
          <div>
            <span>Classification</span>
            <strong>{reconciliation.classification}</strong>
          </div>
        </div>
        {details ? (
          <div className="reconciliation-body">
            <div className="diagnostic-note">
              <strong>{details.determination.replaceAll("-", " ")}</strong>
              <span>{details.explanation}</span>
              <small>Diagnostic only · Salesforce remains read-only</small>
            </div>
            <section>
              <h3>Source and filter criteria</h3>
              <ul>
                {details.sourceCriteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </section>
            <section>
              <h3>Smallest available candidate set</h3>
              <p>
                {details.records.length} shown of {details.includedRecordCount}{" "}
                included Property_Data records · Candidate total{" "}
                {sf(details.candidateTotalSf)}
              </p>
              <div className="reconciliation-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Property</th>
                      <th>Property ID</th>
                      <th>Building SF</th>
                      <th>Canonical submarket</th>
                      <th>Property_Data</th>
                      <th>Official scope</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.records.map((item) => (
                      <tr key={item.propertyDataId}>
                        <td>
                          <strong>{item.property}</strong>
                          {item.address && <small>{item.address}</small>}
                        </td>
                        <td>
                          <code>{item.propertyId ?? "Unavailable"}</code>
                        </td>
                        <td>{sf(item.buildingSf)}</td>
                        <td>{item.canonicalSubmarket}</td>
                        <td>
                          {item.includedInPropertyDataAggregation
                            ? "Included"
                            : "Excluded"}
                        </td>
                        <td>
                          {item.expectedOfficialScope == null
                            ? "Not available at row level"
                            : item.expectedOfficialScope
                              ? "Expected included"
                              : "Expected excluded"}
                        </td>
                        <td>{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <div className="diagnostic-note warning">
            Exact row-level reconciliation is unavailable for this source
            snapshot. The authoritative Market_Data value remains selected.
          </div>
        )}
      </section>
    </div>
  );
}
