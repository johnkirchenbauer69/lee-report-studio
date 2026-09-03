import { CHICAGO_SUBMARKETS } from "../submarkets";
import type { ReportValidationIssue } from "../validation/reportValidation";
import type { NarrativeRecord, NarrativeRevision } from "./schema";
import {
  countNarrativeWords,
  NARRATIVE_PROMPT_PROFILES,
} from "./schema";

export const OVERALL_MARKET_NARRATIVE_ID = "overall-market";

export function initializeNarratives(
  period: string,
  reportDataHash: string,
): NarrativeRecord[] {
  const create = (
    marketId: string,
    marketName: string,
    marketKind: NarrativeRecord["marketKind"],
  ): NarrativeRecord => ({
    marketId,
    marketName,
    marketKind,
    period,
    text: "",
    status: "not_generated",
    source: "manual",
    promptVersion:
      NARRATIVE_PROMPT_PROFILES[marketKind === "overall" ? "overall" : "submarket"]
        .version,
    reportDataHash,
    claims: [],
    contextKeysUsed: [],
    qualityFlags: [],
    revisions: [],
    wordCount: 0,
    overflow: false,
  });
  return [
    create(OVERALL_MARKET_NARRATIVE_ID, "Overall Market", "overall"),
    ...CHICAGO_SUBMARKETS.map((market) =>
      create(market.id, market.displayName, "submarket"),
    ),
  ];
}
export const narrativeRevision = (
  record: NarrativeRecord,
  timestamp: string,
): NarrativeRevision => ({
  id: `revision-${crypto.randomUUID()}`,
  text: record.text,
  source: record.source,
  status: record.status,
  timestamp,
  model: record.model,
  promptVersion: record.promptVersion,
  contextHash: record.contextHash,
  regenerationInstruction: record.regenerationInstruction,
  claims: structuredClone(record.claims),
  qualityFlags: [...record.qualityFlags],
});

export function editNarrative(
  record: NarrativeRecord,
  text: string,
  now = new Date().toISOString(),
): NarrativeRecord {
  const revisions = record.text
    ? [...record.revisions, narrativeRevision(record, now)]
    : record.revisions;
  return {
    ...record,
    text,
    source: "manual",
    status: "edited",
    editedAt: now,
    approvedAt: undefined,
    error: undefined,
    wordCount: countNarrativeWords(text),
    claims: [],
    contextKeysUsed: [],
    qualityFlags: [],
    revisions,
  };
}

export function approveNarrative(
  record: NarrativeRecord,
  now = new Date().toISOString(),
): NarrativeRecord {
  if (!record.text.trim()) throw new Error("A blank narrative cannot be approved.");
  if (record.status === "stale")
    throw new Error("A stale narrative must be reviewed or regenerated first.");
  if (record.status === "failed")
    throw new Error("A failed narrative must be edited or regenerated first.");
  if (record.overflow)
    throw new Error("An overflowing narrative cannot be approved.");
  const profile =
    NARRATIVE_PROMPT_PROFILES[
      record.marketKind === "overall" ? "overall" : "submarket"
    ];
  if (countNarrativeWords(record.text) > profile.hardMaxWords)
    throw new Error(
      `${record.marketName} narrative exceeds the ${profile.hardMaxWords}-word limit.`,
    );
  return { ...record, status: "approved", approvedAt: now, error: undefined };
}

export function unlockNarrative(record: NarrativeRecord): NarrativeRecord {
  if (record.status !== "approved") return record;
  return {
    ...record,
    status: "edited",
    approvedAt: undefined,
    revisions: [
      ...record.revisions,
      narrativeRevision(record, new Date().toISOString()),
    ],
  };
}

export function restoreNarrativeRevision(
  record: NarrativeRecord,
  revisionId: string,
  now = new Date().toISOString(),
): NarrativeRecord {
  const revision = record.revisions.find((item) => item.id === revisionId);
  if (!revision) throw new Error("Narrative revision was not found.");
  return {
    ...record,
    text: revision.text,
    source: revision.source,
    status: "edited",
    model: revision.model,
    promptVersion: revision.promptVersion ?? record.promptVersion,
    contextHash: revision.contextHash,
    claims: structuredClone(revision.claims),
    contextKeysUsed: [
      ...new Set(revision.claims.flatMap((claim) => claim.supportKeys)),
    ],
    qualityFlags: [...revision.qualityFlags],
    editedAt: now,
    approvedAt: undefined,
    error: undefined,
    wordCount: countNarrativeWords(revision.text),
    revisions: [...record.revisions, narrativeRevision(record, now)],
  };
}

export function narrativeReadinessIssues(
  narratives: NarrativeRecord[],
): ReportValidationIssue[] {
  return narratives.flatMap((record) => {
    const path = `narratives.${record.marketId}`;
    if (record.overflow)
      return [{
        path,
        message: `${record.marketName} narrative exceeds its text box.`,
        level: "blocking" as const,
        category: "readiness" as const,
      }];
    if (record.status === "stale")
      return [{
        path,
        message: `${record.marketName} narrative is stale because source data changed.`,
        level: "blocking" as const,
        category: "readiness" as const,
      }];
    if (record.status === "failed")
      return [{
        path,
        message: `${record.marketName} narrative generation failed and requires review.`,
        level: "blocking" as const,
        category: "readiness" as const,
      }];
    if (record.status !== "approved")
      return [{
        path,
        message: `${record.marketName} narrative has not been approved.`,
        level: "blocking" as const,
        category: "readiness" as const,
      }];
    return [];
  });
}
