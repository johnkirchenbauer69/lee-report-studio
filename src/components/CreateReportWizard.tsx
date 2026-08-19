import { useMemo, useRef, useState } from "react";
import { q2Submarkets } from "../data-providers/sample/q2SampleReport";
import type {
  ReportGenerationRequest,
  ReportProviderId,
} from "../report-engine/schema/generation";

interface Props {
  onClose: () => void;
  onGenerate: (request: ReportGenerationRequest) => Promise<void>;
}
const steps = ["Template", "Period", "Source", "Geographies", "Review"];

export function CreateReportWizard({ onClose, onGenerate }: Props) {
  const [step, setStep] = useState(0),
    [period, setPeriod] = useState("2026 Q2"),
    [market, setMarket] = useState("Chicago"),
    [provider, setProvider] = useState<ReportProviderId>("sample");
  const [calculationMode, setCalculationMode] = useState<
      "all-submarkets" | "selected-submarkets"
    >("all-submarkets"),
    [calculationSelected, setCalculationSelected] = useState(() =>
      q2Submarkets.map((item) => item.name),
    ),
    [detailedSelected, setDetailedSelected] = useState<string[]>([]),
    [file, setFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const canContinue =
    provider === "sample" || provider === "ascendix" || !!file;
  const selectedLabel = useMemo(
    () =>
      detailedSelected.length === 0
        ? "No detailed pages"
        : `${detailedSelected.length} detailed page${detailedSelected.length === 1 ? "" : "s"}`,
    [detailedSelected],
  );
  const toggleDetailed = (name: string) =>
    setDetailedSelected((items) =>
      items.includes(name)
        ? items.filter((item) => item !== name)
        : [...items, name],
    );
  const toggleCalculation = (name: string) =>
    setCalculationSelected((items) =>
      items.includes(name)
        ? items.filter((item) => item !== name)
        : [...items, name],
    );
  const generate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      let configuration: unknown;
      if (file) {
        const data = await file.arrayBuffer();
        configuration =
          provider === "json"
            ? { payload: new TextDecoder().decode(data), fileName: file.name }
            : { data, fileName: file.name };
      }
      await onGenerate({
        templateId: "industrial-market-report-q2-2026",
        market,
        period,
        calculationScope:
          calculationMode === "all-submarkets"
            ? { type: "all-submarkets" }
            : {
                type: "selected-submarkets",
                submarkets: calculationSelected,
              },
        pageSelection: { submarkets: detailedSelected },
        source: { provider, configuration },
      });
    } catch (reason) {
      const issue = reason as { message?: string; issues?: string[] };
      setError(
        [issue.message, ...(issue.issues ?? [])].filter(Boolean).join("\n"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wizard-backdrop" role="presentation">
      <section
        className="report-wizard"
        role="dialog"
        aria-modal="true"
        aria-label="Create report"
      >
        <header>
          <div>
            <span className="eyebrow">REPORT GENERATOR</span>
            <h2>Create Report</h2>
            <p>Generate an editable report from validated market data.</p>
          </div>
          <button aria-label="Close report wizard" onClick={onClose}>
            ×
          </button>
        </header>
        <ol className="wizard-steps">
          {steps.map((label, index) => (
            <li
              key={label}
              className={
                index === step ? "active" : index < step ? "complete" : ""
              }
            >
              <span>{index < step ? "✓" : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <div className="wizard-body">
          {step === 0 && (
            <div className="wizard-choice selected">
              <span className="template-preview">IM</span>
              <div>
                <strong>Industrial Market Report</strong>
                <p>
                  LEE & Associates quarterly market template · 4 fixed
                  overall-market pages with optional repeating submarket
                  sections.
                </p>
                <small>Version 1.1.0 · Letter portrait</small>
              </div>
              <span className="choice-check">✓</span>
            </div>
          )}
          {step === 1 && (
            <div className="wizard-form">
              <label>
                Report period
                <select
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                >
                  <option>2026 Q2</option>
                  <option>2026 Q1</option>
                  <option>2025 Q4</option>
                </select>
              </label>
              <label>
                Market
                <input
                  value={market}
                  onChange={(event) => setMarket(event.target.value)}
                />
              </label>
              <div className="wizard-note">
                <strong>Snapshot behavior</strong>
                <span>
                  The generated report preserves the exact normalized data and
                  generation request used at this moment.
                </span>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="source-options">
              {(
                [
                  [
                    "sample",
                    "Sample data",
                    "Use the approved Q2 benchmark fixture.",
                  ],
                  [
                    "json",
                    "Normalized JSON",
                    "Validate and import the formal report schema.",
                  ],
                  [
                    "excel",
                    "Excel workbook",
                    "Map the Q2 Submarket Stats workbook.",
                  ],
                  [
                    "ascendix",
                    "Ascendix",
                    "Use the secure server-side provider boundary.",
                  ],
                ] as [ReportProviderId, string, string][]
              ).map(([id, title, description]) => (
                <button
                  key={id}
                  className={provider === id ? "selected" : ""}
                  onClick={() => {
                    setProvider(id);
                    setFile(undefined);
                  }}
                >
                  <span className="source-icon">
                    {id === "excel"
                      ? "X"
                      : id === "json"
                        ? "{}"
                        : id === "ascendix"
                          ? "A"
                          : "S"}
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </div>
                  <span>{provider === id ? "●" : "○"}</span>
                </button>
              ))}
              {(provider === "json" || provider === "excel") && (
                <div className="file-picker">
                  <input
                    ref={fileRef}
                    hidden
                    type="file"
                    accept={
                      provider === "json"
                        ? ".json,application/json"
                        : ".xlsx,.xls"
                    }
                    onChange={(event) => setFile(event.target.files?.[0])}
                  />
                  <button onClick={() => fileRef.current?.click()}>
                    {file ? "Replace file" : "Choose file"}
                  </button>
                  <span>
                    {file?.name ??
                      (provider === "json"
                        ? "Select a normalized report JSON file"
                        : "Select Submarket Stats - Data Table.xlsx")}
                  </span>
                </div>
              )}
              {provider === "ascendix" && (
                <div className="wizard-note warning">
                  <strong>Server configuration required</strong>
                  <span>
                    Credentials remain on the application server and are never
                    entered into the browser.
                  </span>
                </div>
              )}
            </div>
          )}
          {step === 3 && (
            <div>
              <div className="wizard-scope-section">
                <div className="geography-toolbar">
                  <div>
                    <strong>Overall Market Calculation</strong>
                    <span>
                      Defines the analytical universe for market totals.
                    </span>
                  </div>
                </div>
                <label className="scope-radio">
                  <input
                    type="radio"
                    checked={calculationMode === "all-submarkets"}
                    onChange={() => setCalculationMode("all-submarkets")}
                  />
                  <span>
                    <strong>All Chicago submarkets</strong>
                    <small>Recommended for the Overall Market report.</small>
                  </span>
                </label>
                <label className="scope-radio">
                  <input
                    type="radio"
                    checked={calculationMode === "selected-submarkets"}
                    onChange={() => setCalculationMode("selected-submarkets")}
                  />
                  <span>
                    <strong>Selected submarkets only</strong>
                    <small>Use only for intentionally scoped analysis.</small>
                  </span>
                </label>
                {calculationMode === "selected-submarkets" && (
                  <div className="geography-grid compact">
                    {q2Submarkets.map((item) => (
                      <label key={`calculation-${item.name}`}>
                        <input
                          type="checkbox"
                          checked={calculationSelected.includes(item.name)}
                          onChange={() => toggleCalculation(item.name)}
                        />
                        <span>{item.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="geography-toolbar">
                <div>
                  <strong>Detailed Submarket Pages</strong>
                  <span>{selectedLabel}</span>
                </div>
                <button
                  onClick={() =>
                    setDetailedSelected(
                      detailedSelected.length === q2Submarkets.length
                        ? []
                        : q2Submarkets.map((item) => item.name),
                    )
                  }
                >
                  {detailedSelected.length === q2Submarkets.length
                    ? "Clear all"
                    : "Select all"}
                </button>
              </div>
              <div className="geography-grid">
                {q2Submarkets.map((item) => (
                  <label key={item.name}>
                    <input
                      type="checkbox"
                      checked={detailedSelected.includes(item.name)}
                      onChange={() => toggleDetailed(item.name)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="review-card">
              <div>
                <span>Template</span>
                <strong>Industrial Market Report</strong>
              </div>
              <div>
                <span>Period</span>
                <strong>{period}</strong>
              </div>
              <div>
                <span>Market</span>
                <strong>{market}</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>
                  {provider === "sample"
                    ? "Approved sample"
                    : provider === "json"
                      ? "Normalized JSON"
                      : provider === "excel"
                        ? "Excel workbook"
                        : "Ascendix server"}
                </strong>
              </div>
              <div>
                <span>Calculation scope</span>
                <strong>
                  {calculationMode === "all-submarkets"
                    ? "All Chicago submarkets"
                    : `${calculationSelected.length} selected submarkets`}
                </strong>
              </div>
              <div>
                <span>Detailed pages</span>
                <strong>{selectedLabel}</strong>
              </div>
              <div className="pipeline-preview">
                <span>Load</span>
                <i>→</i>
                <span>Normalize</span>
                <i>→</i>
                <span>Calculate</span>
                <i>→</i>
                <span>Reconcile</span>
                <i>→</i>
                <span>Validate</span>
                <i>→</i>
                <span>Generate</span>
              </div>
            </div>
          )}
          {error && <pre className="wizard-error">{error}</pre>}
        </div>
        <footer>
          <button
            onClick={step === 0 ? onClose : () => setStep((value) => value - 1)}
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          <div>
            <span>
              {step + 1} of {steps.length}
            </span>
            {step < steps.length - 1 ? (
              <button
                className="primary"
                disabled={
                  (step === 2 && !canContinue) ||
                  (step === 3 &&
                    calculationMode === "selected-submarkets" &&
                    !calculationSelected.length)
                }
                onClick={() => setStep((value) => value + 1)}
              >
                Continue
              </button>
            ) : (
              <button className="primary" disabled={busy} onClick={generate}>
                {busy ? "Generating…" : "Generate Report"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
