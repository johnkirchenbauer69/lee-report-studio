import type { PublicNarrativeContext } from "../report-engine/narratives/schema";
import type {
  ManualOverride,
  ExternalNarrativeJob,
  ReportInstance,
} from "../report-engine/schema/generation";
import type { ReportPage } from "../types/report";

export interface NarrativeMcpHealth {
  configured: boolean;
  reachable: boolean;
  mcpUrl?: string;
  toolCount?: number;
  requiredToolsFound: string[];
  missingTools: string[];
  checkedAt: string;
  error?: string;
}

export interface NarrativeConfig {
  configured: boolean;
  model: string;
  concurrency: number;
  message: string;
  mode?: "chatgpt_mcp" | "direct_model";
  provider?: "chatgpt_mcp" | "direct_model";
  chatGptAppUrl?: string;
  pollIntervalMs?: number;
  bridge?: NarrativeMcpHealth;
}

export interface ExternalNarrativeJobState {
  job: ExternalNarrativeJob | null;
  instance: ReportInstance;
  pollIntervalMs: number;
}

export interface NarrativeJob {
  id: string;
  reportInstanceId: string;
  status: "queued" | "running" | "complete";
  total: number;
  completed: number;
  failed: number;
  marketIds: string[];
}

export class ReportSaveConflictError extends Error {
  constructor(
    message: string,
    readonly baseRevision: number,
    readonly currentRevision: number,
  ) {
    super(message);
    this.name = "ReportSaveConflictError";
  }
}

const json = async <T>(input: Response | Promise<Response>): Promise<T> => {
  const response = await input;
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
    baseRevision?: number;
    currentRevision?: number;
  };
  if (response.status === 409 && body.code === "REPORT_INSTANCE_CONFLICT")
    throw new ReportSaveConflictError(
      body.error ?? "The report changed on the server.",
      body.baseRevision ?? -1,
      body.currentRevision ?? -1,
    );
  if (!response.ok)
    throw new Error(body.error ?? `Report API returned ${response.status}.`);
  return body;
};

const send = async <T>(
  url: string,
  method: string,
  body?: unknown,
  timeoutMs?: number,
) => {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = timeoutMs
    ? window.setTimeout(() => controller?.abort(), timeoutMs)
    : undefined;
  try {
    return await json<T>(
      fetch(url, {
        method,
        headers:
          body === undefined
            ? undefined
            : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      }),
    );
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
};

export const reportInstanceStore = {
  lastId: () =>
    localStorage.getItem("lee-report-studio.report-instance.v1") ?? undefined,
  remember: (id: string) =>
    localStorage.setItem("lee-report-studio.report-instance.v1", id),
  forget: () => localStorage.removeItem("lee-report-studio.report-instance.v1"),
  config: () => json<NarrativeConfig>(fetch("/api/narratives/config")),
  create: (instance: ReportInstance) =>
    send<ReportInstance>("/api/report-instances", "POST", instance),
  get: (id: string) =>
    json<ReportInstance>(
      fetch(`/api/report-instances/${encodeURIComponent(id)}`),
    ),
  save: (instance: ReportInstance) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(instance.id)}`,
      "PUT",
      instance,
    ),
  saveDocument: (
    id: string,
    input: {
      baseRevision: number;
      pages: ReportPage[];
      manualOverrides: ManualOverride[];
    },
  ) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/document`,
      "PATCH",
      input,
      15_000,
    ),
  refresh: (id: string) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/refresh`,
      "POST",
    ),
  context: (id: string, marketId: string) =>
    json<PublicNarrativeContext>(
      fetch(
        `/api/report-instances/${encodeURIComponent(id)}/narratives/${encodeURIComponent(marketId)}/context`,
      ),
    ),
  generate: (
    id: string,
    marketId: string,
    options: { instruction?: string; confirmApproved?: boolean } = {},
  ) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/${encodeURIComponent(marketId)}/generate`,
      "POST",
      options,
    ),
  narrativeMcpHealth: () =>
    json<NarrativeMcpHealth>(fetch("/api/integrations/narrative-mcp/health")),
  startExternalGeneration: (
    id: string,
    options: {
      marketIds?: string[];
      instruction?: string;
      confirmApproved?: boolean;
    } = {},
  ) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/external-job`,
      "POST",
      options,
    ),
  retryExternalImport: (id: string) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/external-job/reimport`,
      "POST",
    ),
  externalJob: (id: string) =>
    json<ExternalNarrativeJobState>(
      fetch(
        `/api/report-instances/${encodeURIComponent(id)}/narratives/external-job`,
      ),
    ),
  startGenerateAll: (id: string) =>
    send<NarrativeJob>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/generate-all`,
      "POST",
    ),
  job: (id: string, jobId: string) =>
    json<NarrativeJob>(
      fetch(
        `/api/report-instances/${encodeURIComponent(id)}/narrative-jobs/${encodeURIComponent(jobId)}`,
      ),
    ),
  edit: (id: string, marketId: string, text: string) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/${encodeURIComponent(marketId)}`,
      "PATCH",
      { text },
    ),
  approve: (id: string, marketId: string) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/${encodeURIComponent(marketId)}/approve`,
      "POST",
    ),
  unlock: (id: string, marketId: string) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/${encodeURIComponent(marketId)}/unlock`,
      "POST",
    ),
  restore: (id: string, marketId: string, revisionId: string) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/${encodeURIComponent(marketId)}/restore`,
      "POST",
      { revisionId },
    ),
  overflow: (id: string, marketId: string, overflow: boolean) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(id)}/narratives/${encodeURIComponent(marketId)}/overflow`,
      "POST",
      { overflow },
    ),
};
