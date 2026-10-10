import {
  countNarrativeWords,
  NARRATIVE_SUBMITTED_QUALITY_FLAGS,
  transportPromptVersion,
  type NarrativeContext,
  type NarrativeGenerationResult,
  type NarrativeRecord,
} from "../../src/report-engine/narratives/schema.ts";
import type { NarrativeMcpSubmittedNarrative } from "./NarrativeMcpBridgeClient.ts";
import { validateNarrativeResult } from "./validation.ts";

/**
 * Local re-validation of a narrative batch generated outside Report Studio.
 *
 * Report Studio never trusts what comes back from the bridge. For every
 * returned narrative it rebuilds the CURRENT local NarrativeContext, checks
 * the context has not moved since the job was created, and re-runs the same
 * integrity, numeric, entity, identifier, and length validators that the
 * in-process model path uses.
 *
 * Every narrative is manually reviewed before it can be approved and
 * published, so validation here draws a hard line only around integrity
 * (raw Salesforce IDs, internal workflow language, stale/mismatched
 * context, malformed payload, missing/duplicate/unknown markets, invalid
 * support keys). Entity and numeric grounding ambiguity — a possessive, a
 * punctuation difference, a plausible paraphrase, a name that cannot be
 * matched exactly — is surfaced as a review warning on the imported record
 * (qualityFlags + validationWarnings) instead. A single soft warning on one
 * market must never discard an otherwise-good multi-market batch.
 *
 * Import stays atomic only with respect to hard (integrity) failures: if
 * any requested market fails a hard blocker, nothing is imported and the
 * exact market + reason is reported, avoiding a mixed quarter where some
 * markets reflect current data and others do not. Soft warnings never
 * trigger this — they ride along on the imported Draft for the reviewer.
 */

export interface ExternalBatchFailure {
  marketId: string;
  kind: "unknown_market" | "duplicate_market" | "missing_market" | "stale_context" | "prompt_version" | "validation";
  message: string;
}

export interface ExternalBatchImportPlan {
  ok: boolean;
  failures: ExternalBatchFailure[];
  /** Populated only when ok is true. */
  records: NarrativeRecord[];
  /** Markets whose local context moved while ChatGPT was writing. */
  staleMarketIds: string[];
}

export interface ExternalBatchImportInput {
  narratives: NarrativeMcpSubmittedNarrative[];
  /** Distinctive terms from restricted broker commentary, per market (leak backstop). */
  restrictedBrokerTerms?: (marketId: string) => readonly string[];
  requestedMarketIds: string[];
  /** contextHash recorded when the job was created, per market. */
  jobContextHashes: Record<string, string>;
  /** contextHash the remote reports holding, per market. Cross-checked when present. */
  remoteContextHashes?: Record<string, string>;
  currentRecord: (marketId: string) => NarrativeRecord | undefined;
  currentContext: (marketId: string) => NarrativeContext;
  reportDataHash: string;
  /**
   * Report-data fingerprint recorded when the job was created, and the one
   * the report holds now. When both are present and differ, every market is
   * rejected as stale: the batch was written against a different snapshot
   * than the one it would be exported with.
   */
  jobReportDataFingerprint?: string;
  currentReportDataFingerprint?: string;
  /** Provider snapshot hash recorded at job creation (cross-checked when present). */
  jobReportDataHash?: string;
  now?: string;
  revision: (record: NarrativeRecord, now: string) => NarrativeRecord["revisions"][number];
}

export const EXTERNAL_NARRATIVE_MODEL = "chatgpt-mcp";

export function planExternalBatchImport(
  input: ExternalBatchImportInput,
): ExternalBatchImportPlan {
  const now = input.now ?? new Date().toISOString();
  const failures: ExternalBatchFailure[] = [];
  const staleMarketIds: string[] = [];
  const records: NarrativeRecord[] = [];
  const requested = new Set(input.requestedMarketIds);
  const seen = new Set<string>();
  const snapshotMoved =
    (Boolean(input.jobReportDataFingerprint) &&
      Boolean(input.currentReportDataFingerprint) &&
      input.jobReportDataFingerprint !== input.currentReportDataFingerprint) ||
    (Boolean(input.jobReportDataHash) &&
      Boolean(input.reportDataHash) &&
      input.jobReportDataHash !== input.reportDataHash);
  const submittedFlags = new Set<string>(NARRATIVE_SUBMITTED_QUALITY_FLAGS);

  for (const item of input.narratives) {
    if (!requested.has(item.marketId)) {
      failures.push({
        marketId: item.marketId,
        kind: "unknown_market",
        message: `${item.marketId} was not requested by this narrative job.`,
      });
      continue;
    }
    if (seen.has(item.marketId)) {
      failures.push({
        marketId: item.marketId,
        kind: "duplicate_market",
        message: `${item.marketId} was returned more than once.`,
      });
      continue;
    }
    seen.add(item.marketId);

    const record = input.currentRecord(item.marketId);
    if (!record) {
      failures.push({
        marketId: item.marketId,
        kind: "unknown_market",
        message: `${item.marketId} is not a narrative market on this report.`,
      });
      continue;
    }

    let context: NarrativeContext;
    try {
      context = input.currentContext(item.marketId);
    } catch (error) {
      failures.push({
        marketId: item.marketId,
        kind: "validation",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const jobHash = input.jobContextHashes[item.marketId];
    const remoteHash = input.remoteContextHashes?.[item.marketId];
    if (jobHash && jobHash !== context.contextHash) {
      staleMarketIds.push(item.marketId);
      failures.push({
        marketId: item.marketId,
        kind: "stale_context",
        message: `${record.marketName} source data changed while the narrative was being written. Regenerate it.`,
      });
      continue;
    }
    if (remoteHash && remoteHash !== context.contextHash) {
      staleMarketIds.push(item.marketId);
      failures.push({
        marketId: item.marketId,
        kind: "stale_context",
        message: `${record.marketName} was written against a different governed context than the report now holds. Regenerate it.`,
      });
      continue;
    }
    // Backstop for data that moved without changing this market's context
    // (another market's figures, a data-bearing page override, a new
    // provider snapshot): the batch must not be paired with that data.
    if (snapshotMoved) {
      staleMarketIds.push(item.marketId);
      failures.push({
        marketId: item.marketId,
        kind: "stale_context",
        message: `${record.marketName} was written against a different report data snapshot than the report now holds. Regenerate it.`,
      });
      continue;
    }

    // The generator echoes the transport (narrative-v2) prompt version the
    // public context carried; the contextHash check above already binds the
    // narrative to the exact v3 context it was written against.
    const expectedPromptVersion = transportPromptVersion(context.marketKind);
    if (item.promptVersion !== expectedPromptVersion) {
      failures.push({
        marketId: item.marketId,
        kind: "prompt_version",
        message: `${record.marketName} was written for prompt profile ${item.promptVersion}; this report requires ${expectedPromptVersion}.`,
      });
      continue;
    }

    const result: NarrativeGenerationResult = {
      narrative: item.narrative,
      claims: item.claims ?? [],
      contextKeysUsed: item.contextKeysUsed ?? [],
      // Only transport-contract flags are accepted from the generator;
      // Report Studio's editorial QA flags are always computed locally.
      qualityFlags: (item.qualityFlags ?? []).filter(
        (flag): flag is NarrativeGenerationResult["qualityFlags"][number] =>
          submittedFlags.has(flag),
      ),
    };
    const validation = validateNarrativeResult(context, result, {
      restrictedBrokerTerms: input.restrictedBrokerTerms?.(item.marketId),
    });
    const errors = validation.issues.filter((issue) => issue.severity === "error");
    if (errors.length) {
      failures.push({
        marketId: item.marketId,
        kind: "validation",
        message: `${record.marketName}: ${errors.map((issue) => issue.message).join(" ")}`,
      });
      continue;
    }

    records.push({
      ...record,
      text: result.narrative,
      status: "draft",
      source: "ai",
      promptVersion: context.promptVersion,
      model: EXTERNAL_NARRATIVE_MODEL,
      contextHash: context.contextHash,
      reportDataHash: input.reportDataHash,
      reportDataFingerprint: input.currentReportDataFingerprint,
      generatedAt: now,
      approvedAt: undefined,
      claims: result.claims,
      contextKeysUsed: result.contextKeysUsed,
      qualityFlags: validation.qualityFlags,
      validationWarnings: validation.warnings,
      revisions: record.text
        ? [...record.revisions, input.revision(record, now)]
        : record.revisions,
      wordCount: countNarrativeWords(result.narrative),
      overflow: false,
      error: undefined,
      usage: undefined,
    });
  }

  for (const marketId of input.requestedMarketIds)
    if (!seen.has(marketId))
      failures.push({
        marketId,
        kind: "missing_market",
        message: `${marketId} is missing from the returned batch.`,
      });

  return {
    ok: failures.length === 0,
    failures,
    records: failures.length === 0 ? records : [],
    staleMarketIds,
  };
}

export const externalBatchFailureMessage = (failures: ExternalBatchFailure[]) => {
  if (!failures.length) return "";
  const detail = failures
    .slice(0, 3)
    .map((failure) => failure.message)
    .join(" ");
  const more = failures.length > 3 ? ` (+${failures.length - 3} more)` : "";
  return `ChatGPT returned a batch that failed Report Studio grounding validation. ${detail}${more}`;
};
