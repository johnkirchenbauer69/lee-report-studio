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
import type { ExternalNarrativeJob } from "../../src/report-engine/schema/generation.ts";
import { buildNarrativeContext, publicNarrativeContext } from "./contextBuilder.ts";
import type { NarrativeModelClient } from "./modelClient.ts";
import {
  narrativeHandoffPrompt,
  REQUIRED_NARRATIVE_MCP_TOOLS,
  type NarrativeMcpBridgeClient,
  type NarrativeMcpSubmittedNarrative,
} from "./NarrativeMcpBridgeClient.ts";
import {
  EXTERNAL_NARRATIVE_MODEL,
  externalBatchFailureMessage,
  planExternalBatchImport,
} from "./externalBatchImport.ts";
import { validateNarrativeResult } from "./validation.ts";

/**
 * How the user-facing Generate buttons produce narratives.
 *
 * chatgpt_mcp  ChatGPT writes them through the remote LEE Intelligence MCP.
 *              No OPENAI_API_KEY is required.
 * direct_model In-process model client. Retained for CI and future use.
 *
 * There is one generation workflow. This is an internal mode, never a
 * user-facing provider picker.
 */
export type NarrativeGenerationMode = "chatgpt_mcp" | "direct_model";

export interface NarrativeServiceOptions {
  mode?: NarrativeGenerationMode;
  bridge?: NarrativeMcpBridgeClient;
}

export interface ExternalNarrativeJobState {
  job?: ExternalNarrativeJob;
  instance: ReportInstance;
}

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

  readonly mode: NarrativeGenerationMode;
  private readonly bridge?: NarrativeMcpBridgeClient;

  constructor(
    private readonly repository: ReportInstanceRepository,
    readonly modelClient: NarrativeModelClient,
    readonly concurrency = 3,
    private readonly logger: (entry: Record<string, unknown>) => void = (entry) =>
      console.info(JSON.stringify(entry)),
    options: NarrativeServiceOptions = {},
  ) {
    this.mode = options.mode ?? "direct_model";
    this.bridge = options.bridge;
  }

  /**
   * Whether the Generate buttons are live, and why.
   *
   * In chatgpt_mcp mode this is decided by the bridge — remote MCP reachable
   * and all four narrative job tools present — never by OPENAI_API_KEY.
   */
  async config() {
    if (this.mode !== "chatgpt_mcp")
      return {
        mode: this.mode,
        provider: "direct_model" as const,
        configured: this.modelClient.configured,
        model: this.modelClient.model,
        concurrency: this.concurrency,
        message: this.modelClient.configured
          ? "AI narrative generation is configured."
          : "AI narrative generation is not configured.",
      };
    const health = await this.bridgeHealth();
    return {
      mode: this.mode,
      provider: "chatgpt_mcp" as const,
      configured: health.configured,
      model: EXTERNAL_NARRATIVE_MODEL,
      concurrency: this.concurrency,
      message: health.configured
        ? "ChatGPT narrative generation is ready."
        : "LEE Intelligence MCP narrative bridge is unavailable.",
      chatGptAppUrl: this.bridge?.chatGptAppUrl,
      pollIntervalMs: this.bridge?.pollIntervalMs ?? 1_500,
      bridge: health,
    };
  }

  /** Poll cadence the browser should use against this server. */
  get pollIntervalMs() {
    return this.bridge?.pollIntervalMs ?? 1_500;
  }

  async bridgeHealth(options: { force?: boolean } = {}) {
    if (!this.bridge)
      return {
        configured: false,
        reachable: false,
        requiredToolsFound: [] as string[],
        missingTools: [...REQUIRED_NARRATIVE_MCP_TOOLS],
        checkedAt: new Date().toISOString(),
        error: "The narrative MCP bridge is not configured.",
      };
    return this.bridge.health(options);
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

  // --- ChatGPT / MCP external generation -----------------------------------

  private requireBridge() {
    if (this.mode !== "chatgpt_mcp" || !this.bridge)
      throw new Error("ChatGPT narrative generation is not enabled for this server.");
    return this.bridge;
  }

  /**
   * Markets Generate All should send. Approved and edited narratives are held
   * back unless the caller explicitly confirms overwriting them, so a batch can
   * never silently replace reviewed work.
   */
  private generateAllMarketIds(
    instance: ReportInstance,
    options: { marketIds?: string[]; includeReviewed?: boolean } = {},
  ) {
    if (options.marketIds?.length) {
      for (const marketId of options.marketIds) this.find(instance, marketId);
      return [...options.marketIds];
    }
    return instance.narratives
      .filter((record) =>
        options.includeReviewed
          ? record.status !== "generating"
          : record.status === "not_generated" || record.status === "stale",
      )
      .map((record) => record.marketId);
  }

  /**
   * Creates a narrative job on the remote MCP and parks the report in
   * "Waiting for ChatGPT". Only publication-safe context leaves this process:
   * publicNarrativeContext() strips server-only provenance and throws on any
   * raw Salesforce identifier.
   */
  async startExternalGeneration(
    reportInstanceId: string,
    options: {
      marketIds?: string[];
      includeReviewed?: boolean;
      instruction?: string;
      confirmApproved?: boolean;
    } = {},
  ) {
    const bridge = this.requireBridge();
    const instance = await this.required(reportInstanceId);
    const marketIds = this.generateAllMarketIds(instance, options);
    if (!marketIds.length)
      throw new Error(
        "Every narrative is already generated or approved. Unlock a narrative to regenerate it.",
      );
    if (!options.confirmApproved)
      for (const marketId of marketIds)
        if (this.find(instance, marketId).status === "approved")
          throw new Error(
            "Approved narratives require explicit Unlock / Revise confirmation.",
          );

    const contexts = marketIds.map((marketId) =>
      buildNarrativeContext({ reportInstance: instance, marketId }),
    );
    const publicContexts = contexts.map((context) => publicNarrativeContext(context));
    for (const context of publicContexts)
      for (const fact of context.facts)
        if ("internalSourceIds" in fact)
          throw new Error(
            "Refusing to send narrative context containing server-only source identifiers.",
          );

    const scope: "all" | "selected" =
      marketIds.length === instance.narratives.length ? "all" : "selected";
    const instruction = options.instruction?.trim().slice(0, 300) || undefined;
    const created = await bridge.createJob({
      reportInstanceId,
      templateVersion: instance.templateVersion,
      period: instance.dataSnapshot.report.period,
      market: instance.generationRequest.market,
      generationScope: scope,
      marketIds,
      reportDataHash: instance.sourceSnapshotHash,
      editorialInstruction: instruction,
      contexts: publicContexts,
    });

    const now = new Date().toISOString();
    const job: ExternalNarrativeJob = {
      provider: "chatgpt_mcp",
      jobId: created.jobId,
      status: "waiting_for_chatgpt",
      createdAt: created.createdAt || now,
      updatedAt: now,
      marketIds,
      generationScope: scope,
      appUrl: bridge.chatGptAppUrl,
      handoffPrompt: narrativeHandoffPrompt(created.jobId),
      expiresAt: created.expiresAt || undefined,
      // Recorded locally so import can detect that report data moved while
      // ChatGPT was writing, without trusting the remote to report it.
      contextHashes: Object.fromEntries(
        contexts.map((context) => [context.marketId, context.contextHash]),
      ),
      instruction,
    };
    this.logger({
      event: "narrative_external_job_created",
      reportInstanceId,
      jobId: created.jobId,
      narrativeCount: marketIds.length,
      generationScope: scope,
    });
    return this.repository.update(reportInstanceId, (current) => ({
      ...current,
      externalNarrativeJob: job,
    }));
  }

  /**
   * Polls the remote job on behalf of the browser and imports the batch the
   * moment ChatGPT submits it. The browser only ever talks to this server.
   */
  async externalJobState(reportInstanceId: string): Promise<ExternalNarrativeJobState> {
    const instance = await this.required(reportInstanceId);
    const job = instance.externalNarrativeJob;
    if (!job) return { instance };
    if (job.status === "complete" || job.status === "failed")
      return { job, instance };

    const bridge = this.requireBridge();
    let remote;
    try {
      remote = await bridge.getJob(job.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const gone = /expired|was not found/i.test(message);
      const updated = await this.patchExternalJob(reportInstanceId, {
        status: gone ? "expired" : "waiting_for_chatgpt",
        error: message,
      });
      return { job: updated.externalNarrativeJob, instance: updated };
    }

    if (remote.status === "expired") {
      const updated = await this.patchExternalJob(reportInstanceId, {
        status: "expired",
        error:
          "The narrative job expired before ChatGPT submitted it. Start Generate All again.",
      });
      return { job: updated.externalNarrativeJob, instance: updated };
    }
    if (remote.status !== "complete" || !remote.narratives?.length) {
      const updated = await this.patchExternalJob(reportInstanceId, {
        status: "waiting_for_chatgpt",
        error: undefined,
      });
      return { job: updated.externalNarrativeJob, instance: updated };
    }

    const imported = await this.importExternalGenerationBatch(reportInstanceId, {
      jobId: job.jobId,
      narratives: remote.narratives,
      remoteContextHashes: remote.contextHashes,
    });
    return { job: imported.externalNarrativeJob, instance: imported };
  }

  /**
   * Re-imports a batch that is still sitting on the MCP after a rejected
   * import. A grounding fix or a data refresh should not force the analyst
   * through another ChatGPT round trip while the batch is still retrievable.
   */
  async retryExternalJobImport(reportInstanceId: string) {
    const bridge = this.requireBridge();
    const instance = await this.required(reportInstanceId);
    const job = instance.externalNarrativeJob;
    if (!job) throw new Error("This report has no external narrative job to import.");
    const remote = await bridge.getJob(job.jobId);
    if (remote.status === "expired")
      throw new Error(
        "The narrative job expired before it could be re-imported. Start Generate All again.",
      );
    if (remote.status !== "complete" || !remote.narratives?.length)
      throw new Error("ChatGPT has not submitted this narrative job yet.");
    return this.importExternalGenerationBatch(reportInstanceId, {
      jobId: job.jobId,
      narratives: remote.narratives,
      remoteContextHashes: remote.contextHashes,
    });
  }

  /**
   * Imports an externally generated batch through Report Studio validators.
   * Atomic: if any requested market fails, nothing is imported and existing
   * narratives are left untouched, so a quarter cannot end up half-current.
   */
  async importExternalGenerationBatch(
    reportInstanceId: string,
    input: {
      jobId: string;
      narratives: NarrativeMcpSubmittedNarrative[];
      remoteContextHashes?: Record<string, string>;
    },
  ) {
    const now = new Date().toISOString();
    return this.repository.update(reportInstanceId, (instance) => {
      const job = instance.externalNarrativeJob;
      if (!job || job.jobId !== input.jobId)
        throw new Error("This narrative batch does not belong to the current job.");
      const plan = planExternalBatchImport({
        narratives: input.narratives,
        requestedMarketIds: job.marketIds,
        jobContextHashes: job.contextHashes ?? {},
        remoteContextHashes: input.remoteContextHashes,
        currentRecord: (marketId) =>
          instance.narratives.find((item) => item.marketId === marketId),
        currentContext: (marketId) =>
          buildNarrativeContext({ reportInstance: instance, marketId }),
        reportDataHash: instance.sourceSnapshotHash ?? "",
        now,
        revision: narrativeRevision,
      });

      if (!plan.ok) {
        this.logger({
          event: "narrative_external_batch_rejected",
          reportInstanceId,
          jobId: input.jobId,
          failureCount: plan.failures.length,
          staleMarketIds: plan.staleMarketIds,
        });
        const staleIds = new Set(plan.staleMarketIds);
        return withNarrativeReadiness({
          ...instance,
          narratives: instance.narratives.map((record) =>
            staleIds.has(record.marketId) && record.status !== "approved"
              ? { ...record, status: "stale" as const, approvedAt: undefined }
              : record,
          ),
          externalNarrativeJob: {
            ...job,
            status: "failed",
            updatedAt: now,
            error: externalBatchFailureMessage(plan.failures),
          },
        });
      }

      const byMarket = new Map(plan.records.map((record) => [record.marketId, record]));
      let next: ReportInstance = {
        ...instance,
        narratives: instance.narratives.map(
          (record) => byMarket.get(record.marketId) ?? record,
        ),
        externalNarrativeJob: {
          ...job,
          status: "complete",
          updatedAt: now,
          importedAt: now,
          error: undefined,
        },
      };
      for (const record of plan.records) next = applyText(next, record);
      this.logger({
        event: "narrative_external_batch_imported",
        reportInstanceId,
        jobId: input.jobId,
        narrativeCount: plan.records.length,
      });
      return withNarrativeReadiness(next);
    });
  }

  private patchExternalJob(
    reportInstanceId: string,
    patch: Partial<ExternalNarrativeJob>,
  ) {
    return this.repository.update(reportInstanceId, (instance) =>
      instance.externalNarrativeJob
        ? {
            ...instance,
            externalNarrativeJob: {
              ...instance.externalNarrativeJob,
              ...patch,
              updatedAt: new Date().toISOString(),
            },
          }
        : instance,
    );
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
