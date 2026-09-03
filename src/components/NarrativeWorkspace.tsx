import { useEffect, useMemo, useState } from "react";
import type {
  NarrativeContextCategory,
  PublicNarrativeContext,
} from "../report-engine/narratives/schema";
import { NARRATIVE_PROMPT_PROFILES } from "../report-engine/narratives/schema";
import type {
  ExternalNarrativeJob,
  ReportInstance,
} from "../report-engine/schema/generation";
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

function ExternalJobPanel({
  job,
  appUrl,
  copied,
  busy,
  onOpenApp,
  onCopy,
  onRetryImport,
}: {
  job: ExternalNarrativeJob;
  appUrl?: string;
  copied: boolean;
  busy: boolean;
  onOpenApp: () => void;
  onCopy: () => void;
  onRetryImport: () => void;
}) {
  const shortId = job.jobId.slice(0, 8);
  const waiting =
    job.status === "waiting_for_chatgpt" || job.status === "creating";
  const heading =
    job.status === "complete"
      ? "ChatGPT narratives imported"
      : job.status === "failed"
      ? "ChatGPT batch rejected"
      : job.status === "expired"
      ? "Narrative job expired"
      : "Waiting for ChatGPT";
  return (
    <div
      className={`narrative-external-job status-${job.status}`}
      role="status"
      data-testid="narrative-external-job"
    >
      <div className="narrative-external-job-header">
        <strong>{heading}</strong>
        <span>
          Narrative job: <code>{shortId}</code>
        </span>
        <span>{job.marketIds.length} narrative contexts prepared</span>
      </div>
      {waiting && (
        <>
          <div className="narrative-external-job-actions">
            {appUrl && (
              <button type="button" onClick={onOpenApp}>
                Open ChatGPT
              </button>
            )}
            <button type="button" onClick={onCopy}>
              {copied ? "Handoff Prompt Copied" : "Copy Handoff Prompt"}
            </button>
          </div>
          {job.handoffPrompt && (
            <p className="narrative-handoff-prompt">{job.handoffPrompt}</p>
          )}
          <p className="narrative-external-job-status">
            Status: Waiting for LEE Intelligence to submit narratives...
          </p>
        </>
      )}
      {job.status === "failed" && (
        <div className="narrative-external-job-actions">
          <button type="button" disabled={busy} onClick={onRetryImport}>
            {busy ? "Retrying Import..." : "Retry Import"}
          </button>
        </div>
      )}
      {job.error && <p className="narrative-error">{job.error}</p>}
    </div>
  );
}

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
  const [copied, setCopied] = useState(false);
  const externalJob = instance.externalNarrativeJob;
  const waitingForChatGpt =
    externalJob?.status === "waiting_for_chatgpt" || externalJob?.status === "creating";
  const chatGptMode = config?.mode === "chatgpt_mcp";

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
  // Poll only this server. The Report Studio API polls the remote MCP and
  // imports the batch the moment ChatGPT submits it.
  useEffect(() => {
    if (!waitingForChatGpt) return;
    let cancelled = false;
    const interval = config?.pollIntervalMs ?? 1_500;
    const timer = window.setInterval(async () => {
      try {
        const state = await reportInstanceStore.externalJob(instance.id);
        if (cancelled) return;
        onChange(state.instance);
        if (state.job?.status !== "waiting_for_chatgpt") setBusy(undefined);
        if (state.job?.status === "failed" || state.job?.status === "expired")
          setError(state.job.error);
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }, interval);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [config?.pollIntervalMs, instance.id, onChange, waitingForChatGpt]);

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
  const copyHandoff = async (prompt?: string) => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 4_000);
    } catch {
      setCopied(false);
    }
  };
  // Opened synchronously from the click so the browser keeps the user gesture.
  const openChatGptApp = () => {
    if (config?.chatGptAppUrl)
      window.open(config.chatGptAppUrl, "_blank", "noopener,noreferrer");
  };
  const startExternal = async (
    scope: "all" | "selected",
    options: { instruction?: string; confirmApproved?: boolean } = {},
  ) => {
    setBusy(scope === "all" ? "all" : selected.marketId);
    setError(undefined);
    openChatGptApp();
    try {
      const next = await reportInstanceStore.startExternalGeneration(instance.id, {
        marketIds: scope === "selected" ? [selected.marketId] : undefined,
        ...options,
      });
      onChange(next);
      await copyHandoff(next.externalNarrativeJob?.handoffPrompt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(undefined);
    }
  };
  // The batch usually still sits on the MCP after a rejected import, so a
  // grounding fix does not need another ChatGPT round trip.
  const retryImport = async () => {
    setBusy("reimport");
    setError(undefined);
    try {
      onChange(await reportInstanceStore.retryExternalImport(instance.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
    }
  };
  const generate = () =>
    chatGptMode
      ? startExternal("selected", {
          instruction: instruction.trim() || undefined,
          confirmApproved: selected.status === "approved",
        })
      : update(() =>
          reportInstanceStore.generate(instance.id, selected.marketId, {
            instruction: instruction.trim() || undefined,
            confirmApproved: selected.status === "approved",
          }),
        );
  const generateAll = async () => {
    if (chatGptMode) return startExternal("all");
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
          <strong>{config.message}</strong>
          <span>Manual narrative editing and approval remain available.</span>
        </div>
      )}
      {externalJob && <ExternalJobPanel
        job={externalJob}
        appUrl={config?.chatGptAppUrl}
        copied={copied}
        busy={busy === "reimport"}
        onOpenApp={openChatGptApp}
        onCopy={() => copyHandoff(externalJob.handoffPrompt)}
        onRetryImport={retryImport}
      />}
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
