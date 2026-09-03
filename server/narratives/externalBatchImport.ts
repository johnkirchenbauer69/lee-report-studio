import {
  countNarrativeWords,
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
 * grounding, numeric, entity, identifier, and length validators that the
 * in-process model path uses.
 *
 * Import is atomic: if any requested market fails, nothing is imported. That
 * avoids a mixed quarter where some markets reflect current data and others
 * do not.
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
  requestedMarketIds: string[];
  /** contextHash recorded when the job was created, per market. */
  jobContextHashes: Record<string, string>;
  /** contextHash the remote reports holding, per market. Cross-checked when present. */
  remoteContextHashes?: Record<string, string>;
  currentRecord: (marketId: string) => NarrativeRecord | undefined;
  currentContext: (marketId: string) => NarrativeContext;
  reportDataHash: string;
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

    if (item.promptVersion !== context.promptVersion) {
      failures.push({
        marketId: item.marketId,
        kind: "prompt_version",
        message: `${record.marketName} was written for prompt profile ${item.promptVersion}; this report requires ${context.promptVersion}.`,
      });
      continue;
    }

    const result: NarrativeGenerationResult = {
      narrative: item.narrative,
      claims: item.claims ?? [],
      contextKeysUsed: item.contextKeysUsed ?? [],
      qualityFlags: item.qualityFlags ?? [],
    };
    const validation = validateNarrativeResult(context, result);
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
      generatedAt: now,
      approvedAt: undefined,
      claims: result.claims,
      contextKeysUsed: result.contextKeysUsed,
      qualityFlags: validation.qualityFlags,
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
