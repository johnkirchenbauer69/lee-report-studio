import { randomUUID } from "node:crypto";
import type { ReportInstanceRepository } from "../report-instances/FileSystemReportInstanceRepository.ts";
import {
  approveNarrative,
  editNarrative,
  narrativeReadinessIssues,
  narrativeRevision,
  restoreNarrativeRevision,
  unlockNarrative,
} from "../../src/report-engine/narratives/workflow.ts";
import {
  countNarrativeWords,
  type NarrativeRecord,
} from "../../src/report-engine/narratives/schema.ts";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import { buildNarrativeContext, publicNarrativeContext } from "./contextBuilder.ts";
import type { NarrativeModelClient } from "./modelClient.ts";
import { validateNarrativeResult } from "./validation.ts";

export interface NarrativeGenerationJob {
  id: string;
  reportInstanceId: string;
  status: "queued" | "running" | "complete";
  total: number;
  completed: number;
  failed: number;
  marketIds: string[];
}

const friendlyError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Narrative generation failed.";
  if (/rate.?limit|429/i.test(message)) return "The narrative service is temporarily rate limited. Please retry.";
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return "The narrative request timed out. Please retry.";
  if (/not configured/i.test(message)) return "AI narrative generation is not configured.";
  if (/refus/i.test(message)) return "The narrative model declined this request. Review the context and retry.";
  if (/support key|numeric fact|named entity|word|structured output|incomplete/i.test(message))
    return message;
  return "The narrative service is temporarily unavailable. Please retry.";
};

const applyText = (
  instance: ReportInstance,
  record: NarrativeRecord,
): ReportInstance => {
  const dataSnapshot = structuredClone(instance.dataSnapshot);
  if (record.marketKind === "overall") dataSnapshot.overallMarket.narrative = record.text;
  else {
    const detail = dataSnapshot.submarketDetails.find(
      (item) =>
        item.id === record.marketId ||
        item.canonicalName === record.marketName ||
        item.displayName === record.marketName ||
        item.name === record.marketName,
    );
    if (detail) detail.narrative = record.text;
  }
  return { ...instance, dataSnapshot };
};

const withNarrativeReadiness = (instance: ReportInstance): ReportInstance => {
  const nonNarrativeIssues = instance.readiness.issues.filter(
    (issue) => !issue.path.startsWith("narratives."),
  );
  const narrativeIssues = narrativeReadinessIssues(instance.narratives);
  const issues = [...nonNarrativeIssues, ...narrativeIssues];
  const blockers = issues.filter(
    (issue) => issue.level === "blocking" || issue.level === "error",
  );
  return {
    ...instance,
    readiness: {
      ...instance.readiness,
      canApprove: blockers.length === 0,
      canPublish: blockers.length === 0,
      blockers,
      issues,
    },
  };
};

const replaceRecord = (
  instance: ReportInstance,
  record: NarrativeRecord,
) =>
  withNarrativeReadiness(
    applyText(
      {
        ...instance,
        narratives: instance.narratives.map((item) =>
          item.marketId === record.marketId ? record : item,
        ),
      },
      record,
    ),
  );

export class NarrativeService {
  private readonly jobs = new Map<string, NarrativeGenerationJob>();

  constructor(
    private readonly repository: ReportInstanceRepository,
    readonly modelClient: NarrativeModelClient,
    readonly concurrency = 3,
    private readonly logger: (entry: Record<string, unknown>) => void = (entry) =>
      console.info(JSON.stringify(entry)),
  ) {}

  config() {
    return {
      configured: this.modelClient.configured,
      model: this.modelClient.model,
      concurrency: this.concurrency,
      message: this.modelClient.configured
        ? "AI narrative generation is configured."
        : "AI narrative generation is not configured.",
    };
  }

  async context(reportInstanceId: string, marketId: string) {
    const instance = await this.required(reportInstanceId);
    return publicNarrativeContext(buildNarrativeContext({ reportInstance: instance, marketId }));
  }

  async refreshStaleness(reportInstanceId: string) {
    return this.repository.update(reportInstanceId, (instance) => {
      const narratives = instance.narratives.map((record) => {
        if (!record.contextHash || record.status === "not_generated" || record.status === "generating")
          return record;
        const current = buildNarrativeContext({ reportInstance: instance, marketId: record.marketId });
        return current.contextHash === record.contextHash
          ? record
          : { ...record, status: "stale" as const, approvedAt: undefined };
      });
      return withNarrativeReadiness({ ...instance, narratives });
    });
  }

  async edit(reportInstanceId: string, marketId: string, text: string) {
    return this.repository.update(reportInstanceId, (instance) => {
      const current = this.find(instance, marketId);
      const context = buildNarrativeContext({ reportInstance: instance, marketId });
      return replaceRecord(instance, {
        ...editNarrative(current, text),
        contextHash: context.contextHash,
        reportDataHash: instance.sourceSnapshotHash ?? current.reportDataHash,
        overflow: false,
      });
    });
  }

  async approve(reportInstanceId: string, marketId: string) {
    return this.repository.update(reportInstanceId, (instance) => {
      const current = this.find(instance, marketId);
      const context = buildNarrativeContext({ reportInstance: instance, marketId });
      if (current.contextHash && current.contextHash !== context.contextHash)
        return replaceRecord(instance, { ...current, status: "stale", approvedAt: undefined });
      return replaceRecord(instance, approveNarrative({ ...current, contextHash: context.contextHash }));
    });
  }

  async unlock(reportInstanceId: string, marketId: string) {
    return this.repository.update(reportInstanceId, (instance) =>
      replaceRecord(instance, unlockNarrative(this.find(instance, marketId))),
    );
  }

  async restore(reportInstanceId: string, marketId: string, revisionId: string) {
    return this.repository.update(reportInstanceId, (instance) =>
      replaceRecord(
        instance,
        restoreNarrativeRevision(this.find(instance, marketId), revisionId),
      ),
    );
  }

  async setOverflow(reportInstanceId: string, marketId: string, overflow: boolean) {
    return this.repository.update(reportInstanceId, (instance) =>
      replaceRecord(instance, { ...this.find(instance, marketId), overflow }),
    );
  }

  async generate(
    reportInstanceId: string,
    marketId: string,
    options: { instruction?: string; confirmApproved?: boolean } = {},
  ) {
    const startedAt = Date.now();
    let context = buildNarrativeContext({
      reportInstance: await this.required(reportInstanceId),
      marketId,
    });
    const initial = await this.repository.update(reportInstanceId, (instance) => {
      const record = this.find(instance, marketId);
      if (record.status === "approved" && !options.confirmApproved)
        throw new Error("Approved narratives require explicit Unlock / Revise confirmation.");
      context = buildNarrativeContext({ reportInstance: instance, marketId });
      return replaceRecord(instance, {
        ...record,
        status: "generating",
        error: undefined,
        regenerationInstruction: options.instruction?.trim().slice(0, 300) || undefined,
      });
    });
    const record = this.find(initial, marketId);
    this.logger({
      event: "narrative_generation_requested",
      reportInstanceId,
      marketId,
      marketName: record.marketName,
      promptVersion: context.promptVersion,
      contextHash: context.contextHash,
    });
    try {
      const response = await this.modelClient.generate(context, options.instruction);
      const validation = validateNarrativeResult(context, response.result);
      const errors = validation.issues.filter((issue) => issue.severity === "error");
      if (errors.length) throw new Error(errors.map((issue) => issue.message).join(" "));
      const completed = await this.repository.update(reportInstanceId, (instance) => {
        const latest = this.find(instance, marketId);
        const now = new Date().toISOString();
        const next: NarrativeRecord = {
          ...latest,
          text: response.result.narrative,
          status: "draft",
          source: "ai",
          promptVersion: context.promptVersion,
          model: response.model,
          contextHash: context.contextHash,
          reportDataHash: instance.sourceSnapshotHash ?? latest.reportDataHash,
          generatedAt: now,
          approvedAt: undefined,
          claims: response.result.claims,
          contextKeysUsed: response.result.contextKeysUsed,
          qualityFlags: validation.qualityFlags,
          revisions: latest.text
            ? [...latest.revisions, narrativeRevision(latest, now)]
            : latest.revisions,
          wordCount: countNarrativeWords(response.result.narrative),
          overflow: false,
          error: undefined,
          usage: response.usage,
        };
        return replaceRecord(instance, next);
      });
      this.logger({
        event: "narrative_generation_completed",
        reportInstanceId,
        marketId,
        promptVersion: context.promptVersion,
        contextHash: context.contextHash,
        model: response.model,
        durationMs: Date.now() - startedAt,
        result: "success",
      });
      return completed;
    } catch (error) {
      const message = friendlyError(error);
      const failed = await this.repository.update(reportInstanceId, (instance) =>
        replaceRecord(instance, {
          ...this.find(instance, marketId),
          status: "failed",
          error: message,
          approvedAt: undefined,
        }),
      );
      this.logger({
        event: "narrative_generation_completed",
        reportInstanceId,
        marketId,
        promptVersion: context.promptVersion,
        contextHash: context.contextHash,
        durationMs: Date.now() - startedAt,
        result: "error",
        errorCode: "narrative_generation_failed",
      });
      return failed;
    }
  }

  async startGenerateAll(reportInstanceId: string) {
    const instance = await this.required(reportInstanceId);
    const marketIds = instance.narratives
      .filter((record) => record.status === "not_generated" || record.status === "stale")
      .map((record) => record.marketId);
    const job: NarrativeGenerationJob = {
      id: `narrative-job-${randomUUID()}`,
      reportInstanceId,
      status: marketIds.length ? "queued" : "complete",
      total: marketIds.length,
      completed: 0,
      failed: 0,
      marketIds,
    };
    this.jobs.set(job.id, job);
    if (marketIds.length) void this.runJob(job.id);
    return structuredClone(job);
  }

  job(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Narrative generation job not found.");
    return structuredClone(job);
  }

  private async runJob(id: string) {
    const job = this.jobs.get(id)!;
    job.status = "running";
    let cursor = 0;
    const worker = async () => {
      while (cursor < job.marketIds.length) {
        const marketId = job.marketIds[cursor++]!;
        const result = await this.generate(job.reportInstanceId, marketId);
        const record = this.find(result, marketId);
        job.completed += 1;
        if (record.status === "failed") job.failed += 1;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, job.total) }, () => worker()),
    );
    job.status = "complete";
  }

  private async required(id: string) {
    const instance = await this.repository.get(id);
    if (!instance) throw new Error("Report instance not found.");
    return instance;
  }

  private find(instance: ReportInstance, marketId: string) {
    const record = instance.narratives.find((item) => item.marketId === marketId);
    if (!record) throw new Error("Narrative market not found.");
    return record;
  }
}
