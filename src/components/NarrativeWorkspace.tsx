import { useEffect, useMemo, useState } from "react";
import type {
  NarrativeContextCategory,
  PublicNarrativeContext,
} from "../report-engine/narratives/schema";
import { NARRATIVE_PROMPT_PROFILES } from "../report-engine/narratives/schema";
import type { ReportInstance } from "../report-engine/schema/generation";
import {
  reportInstanceStore,
  type NarrativeConfig,
  type NarrativeJob,
} from "../services/reportInstanceStore";

interface Props {
  instance: ReportInstance;
  onChange: (instance: ReportInstance) => void;
}

const labels: Record<NarrativeContextCategory, string> = {
  metric: "Market Metrics",
  trend: "Market Trends",
  ranking: "Submarket Rankings",
  driver: "Drivers & Contributors",
  lease: "Leases",
  sale: "Sales",
  availability: "Availability",
  construction: "Construction",
  delivery: "Deliveries",
};

const statusLabel = (status: string) =>
  status.replace(/_/g, " ").replace(/^./, (value) => value.toUpperCase());

export function NarrativeWorkspace({ instance, onChange }: Props) {
  const [selectedMarketId, setSelectedMarketId] = useState(
    instance.narratives[0]?.marketId ?? "overall-market",
  );
  const selected =
    instance.narratives.find((item) => item.marketId === selectedMarketId) ??
    instance.narratives[0]!;
  const [draftText, setDraftText] = useState(selected.text);
  const [instruction, setInstruction] = useState("");
  const [context, setContext] = useState<PublicNarrativeContext>();
  const [config, setConfig] = useState<NarrativeConfig>();
  const [job, setJob] = useState<NarrativeJob>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => setDraftText(selected.text), [selected.marketId, selected.text]);
  useEffect(() => {
    reportInstanceStore.config().then(setConfig).catch(() =>
      setConfig({
        configured: false,
        model: "unavailable",
        concurrency: 3,
        message: "AI narrative generation is not configured.",
      }),
    );
  }, []);
  useEffect(() => {
    setContext(undefined);
    reportInstanceStore
      .context(instance.id, selected.marketId)
      .then(setContext)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [instance.id, selected.marketId]);
  useEffect(() => {
    if (!job || job.status === "complete") return;
    const timer = window.setInterval(async () => {
      try {
        const nextJob = await reportInstanceStore.job(instance.id, job.id);
        setJob(nextJob);
        onChange(await reportInstanceStore.get(instance.id));
        if (nextJob.status === "complete") setBusy(undefined);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(undefined);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [instance.id, job, onChange]);

  const factsByCategory = useMemo(() => {
    const groups = new Map<NarrativeContextCategory, PublicNarrativeContext["facts"]>();
    context?.facts.forEach((item) =>
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]),
    );
    return [...groups.entries()];
  }, [context]);
  const profile =
    NARRATIVE_PROMPT_PROFILES[
      selected.marketKind === "overall" ? "overall" : "submarket"
    ];
  const update = async (action: () => Promise<ReportInstance>) => {
    setBusy(selected.marketId);
    setError(undefined);
    try {
      onChange(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
    }
  };
  const generate = () =>
    update(() =>
      reportInstanceStore.generate(instance.id, selected.marketId, {
        instruction: instruction.trim() || undefined,
        confirmApproved: selected.status === "approved",
      }),
    );
  const generateAll = async () => {
    setBusy("all");
    setError(undefined);
    try {
      setJob(await reportInstanceStore.startGenerateAll(instance.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(undefined);
    }
  };

  return (
    <div className="narrative-workspace" data-testid="narrative-workspace">
      <div className="narrative-toolbar">
        <div>
          <strong>Narratives</strong>
          <span>Overall Market + 18 canonical submarkets</span>
        </div>
        <button
          className="primary"
          disabled={busy === "all" || !config?.configured}
          onClick={generateAll}
        >
          Generate All Narratives
        </button>
      </div>
      {config && !config.configured && (
        <div className="wizard-note warning" role="status">
          <strong>AI narrative generation is not configured.</strong>
          <span>Manual narrative editing and approval remain available.</span>
        </div>
      )}
      {job && (
        <div className="narrative-progress" role="status">
          Generating narratives {job.completed} / {job.total}
          {job.failed ? ` · ${job.failed} failed` : ""}
        </div>
      )}
      {!instance.readiness.canPublish && (
        <div className="narrative-readiness" role="status">
          <strong>{instance.readiness.blockers.length} publication blockers</strong>
          <span>{instance.readiness.blockers[0]?.message}</span>
        </div>
      )}
      {error && <div className="narrative-error">{error}</div>}
      <div className="narrative-layout">
        <div className="narrative-list" role="list" aria-label="Narrative markets">
          <div className="narrative-list-header">
            <span>Market</span><span>Status</span><span>Words</span><span>Warnings</span>
          </div>
          {instance.narratives.map((record) => (
            <button
              key={record.marketId}
              role="listitem"
              className={record.marketId === selected.marketId ? "selected" : ""}
              onClick={() => setSelectedMarketId(record.marketId)}
            >
              <strong>{record.marketName}</strong>
              <span className={`narrative-status status-${record.status}`}>
                {statusLabel(record.status)}
              </span>
              <span>{record.wordCount}</span>
              <span>{record.qualityFlags.length + (record.overflow ? 1 : 0)}</span>
            </button>
          ))}
        </div>
        <div className="narrative-editor">
          <header>
            <div>
              <h3>{selected.marketName}</h3>
              <span className={`narrative-status status-${selected.status}`}>
                {statusLabel(selected.status)}
              </span>
            </div>
            <span>{draftText.trim() ? draftText.trim().split(/\s+/).length : 0} / {profile.hardMaxWords} words</span>
          </header>
          <textarea
            aria-label={`${selected.marketName} narrative`}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            className={draftText.trim().split(/\s+/).length > profile.hardMaxWords ? "overflow" : ""}
          />
          {(selected.overflow || draftText.trim().split(/\s+/).length > profile.hardMaxWords) && (
            <p className="narrative-overflow">Narrative exceeds its publication-safe text capacity.</p>
          )}
          <label className="narrative-instruction">
            Optional regeneration instruction
            <input
              value={instruction}
              maxLength={300}
              placeholder="Example: Emphasize leasing activity."
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <div className="narrative-actions">
            <button
              disabled={busy === selected.marketId || draftText === selected.text}
              onClick={() => update(() => reportInstanceStore.edit(instance.id, selected.marketId, draftText))}
            >Save Edit</button>
            {selected.status === "approved" ? (
              <button onClick={() => update(() => reportInstanceStore.unlock(instance.id, selected.marketId))}>
                Unlock / Revise
              </button>
            ) : (
              <button disabled={!config?.configured || busy === selected.marketId} onClick={generate}>
                {selected.status === "not_generated" ? "Generate" : "Regenerate"}
              </button>
            )}
            <button
              className="primary"
              disabled={!selected.text.trim() || selected.status === "approved" || busy === selected.marketId}
              onClick={() => update(() => reportInstanceStore.approve(instance.id, selected.marketId))}
            >Approve</button>
          </div>
          {selected.error && <p className="narrative-error">{selected.error}</p>}
          {!!selected.qualityFlags.length && (
            <div className="quality-flags">
              {selected.qualityFlags.map((flag) => <span key={flag}>{statusLabel(flag)}</span>)}
            </div>
          )}
          <details className="narrative-evidence">
            <summary>Why did AI write this?</summary>
            {factsByCategory.map(([category, facts]) => (
              <section key={category}>
                <h4>{labels[category]}</h4>
                {facts.map((item) => (
                  <div key={item.contextKey}>
                    <strong>{item.label}</strong>
                    <span>{item.displayValue}</span>
                  </div>
                ))}
              </section>
            ))}
            {!!selected.claims.length && (
              <section>
                <h4>Claim Support</h4>
                {selected.claims.map((claim, index) => (
                  <div key={`${claim.claim}-${index}`} className="claim-support">
                    <strong>{claim.claim}</strong>
                    <span>Supported by: {claim.supportKeys.join(", ")}</span>
                  </div>
                ))}
              </section>
            )}
          </details>
          {!!selected.revisions.length && (
            <details className="narrative-revisions">
              <summary>Revision history ({selected.revisions.length})</summary>
              {selected.revisions.map((revision) => (
                <div key={revision.id}>
                  <span>{new Date(revision.timestamp).toLocaleString()} · {statusLabel(revision.status)}</span>
                  <button onClick={() => update(() => reportInstanceStore.restore(instance.id, selected.marketId, revision.id))}>Restore</button>
                </div>
              ))}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
