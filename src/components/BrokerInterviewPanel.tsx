import { useRef, useState } from "react";
import {
  BROKER_TOPIC_LABELS,
  brokerCoverageSummary,
  type BrokerPublicationStatus,
} from "../report-engine/narratives/brokerInterviews";
import type { ReportInstance } from "../report-engine/schema/generation";
import { reportInstanceStore } from "../services/reportInstanceStore";

const STATUS_LABELS: Record<BrokerPublicationStatus, string> = {
  PUBLISHABLE: "Publishable",
  RESTRICTED: "Restricted · never sent",
  UNCERTAIN: "Uncertain · not sent",
  REVIEW_REQUIRED: "Review required · not sent",
};

const ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Optional broker interview upload for the Narratives step. Broker commentary
 * is supplemental qualitative context only; generation never depends on it.
 */
export function BrokerInterviewPanel({
  instance,
  onChange,
  disabled,
}: {
  instance: ReportInstance;
  onChange: (instance: ReportInstance) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [showReview, setShowReview] = useState(false);
  const set = instance.brokerInterviews;
  const summary = brokerCoverageSummary(set);
  const periodMismatch = Boolean(set && set.period !== instance.dataSnapshot.report.period);
  const state = processing
    ? "Processing"
    : error
      ? "Failed"
      : !set
        ? "Not uploaded"
        : set.status === "review_needed" || periodMismatch
          ? "Review needed"
          : "Ready";

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setProcessing(true);
    setError(undefined);
    try {
      onChange(await reportInstanceStore.uploadBrokerInterviews(instance.id, file));
      setShowReview(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProcessing(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setProcessing(true);
    setError(undefined);
    try {
      onChange(await reportInstanceStore.removeBrokerInterviews(instance.id));
      setShowReview(false);
      setExpanded(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProcessing(false);
    }
  };
  const excluded = (market: (typeof summary.markets)[number]) =>
    market.restricted + market.uncertain + market.reviewRequired;

  return (
    <section
      className={`broker-interviews state-${state.toLowerCase().replace(/\s+/g, "-")}`}
      data-testid="broker-interviews"
      aria-label="Broker interviews"
    >
      <div className="broker-interviews-header">
        <div>
          <strong>(Optional) Upload Broker Interviews</strong>
          <span>
            Add broker interview notes to supplement the governed market data. Interview
            commentary will not override report metrics.
          </span>
        </div>
        <div className="broker-interviews-actions">
          <span className="broker-interviews-state" data-testid="broker-interviews-state">
            {state}
          </span>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            hidden
            data-testid="broker-interviews-input"
            onChange={(event) => upload(event.target.files?.[0])}
          />
          <button
            type="button"
            disabled={disabled || processing}
            onClick={() => input.current?.click()}
          >
            {set ? "Replace File" : "Upload PDF or Word"}
          </button>
          {set && (
            <button type="button" disabled={disabled || processing} onClick={remove}>
              Remove
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="broker-interviews-error" role="alert">
          {error} Narratives can still be generated without broker context
          {set ? "; the previously uploaded interviews remain in use." : "."}
        </div>
      )}
      {set && (
        <div className="broker-interviews-summary">
          <span>
            <strong>{set.sourceFileName}</strong> · {set.pageCount} pages · {set.period}
          </span>
          <span data-testid="broker-interviews-coverage">
            Broker context prepared for {summary.preparedSubmarkets} of{" "}
            {summary.totalSubmarkets} submarkets
          </span>
          <button type="button" className="link" onClick={() => setShowReview((value) => !value)}>
            {showReview ? "Hide review" : "Review extraction"}
          </button>
        </div>
      )}
      {periodMismatch && (
        <div className="broker-interviews-error" role="status">
          These interviews were captured for {set!.period}, not {instance.dataSnapshot.report.period}. They
          will not be used until a matching file is uploaded.
        </div>
      )}
      {set && showReview && (
        <div className="broker-interviews-review" data-testid="broker-interviews-review">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Publishable</th>
                <th>Excluded</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {summary.markets.map((market) => (
                <tr key={market.marketId}>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        setExpanded((value) =>
                          value === market.marketId ? undefined : market.marketId,
                        )
                      }
                    >
                      {market.marketName}
                    </button>
                  </td>
                  <td>{market.coverage === "matched" ? market.publishable : "Not covered"}</td>
                  <td title={`${market.restricted} restricted · ${market.uncertain} uncertain · ${market.reviewRequired} review required`}>
                    {excluded(market)}
                    {market.restricted ? ` (${market.restricted} restricted)` : ""}
                  </td>
                  <td>{market.warnings.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {expanded && (
            <ul className="broker-interviews-observations">
              {set.markets
                .find((market) => market.marketId === expanded)
                ?.observations.map((item) => (
                  <li key={item.contextKey} className={`status-${item.publicationStatus.toLowerCase()}`}>
                    <span className="broker-observation-status">
                      {STATUS_LABELS[item.publicationStatus]}
                    </span>
                    <span className="broker-observation-topic">{BROKER_TOPIC_LABELS[item.topic]}</span>
                    <span>{item.statement}</span>
                    {item.reasons.length > 0 && (
                      <em className="broker-observation-reason">{item.reasons.join("; ")}</em>
                    )}
                  </li>
                ))}
            </ul>
          )}
          {(set.unmatchedSections.some((item) => item.reason !== "preamble") || set.warnings.length > 0) && (
            <div className="broker-interviews-warnings">
              {set.unmatchedSections
                .filter((item) => item.reason !== "preamble")
                .map((item) => (
                  <p key={`${item.heading}-${item.page}`}>
                    Unmatched section “{item.heading}”
                    {item.page ? ` (page ${item.page})` : ""}: {item.reason.replace(/_/g, " ")}.
                  </p>
                ))}
              {set.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
