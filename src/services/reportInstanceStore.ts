import type { PublicNarrativeContext } from "../report-engine/narratives/schema";
import type {
  ExternalNarrativeJob,
  ReportInstance,
} from "../report-engine/schema/generation";

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

const json = async <T>(input: Response | Promise<Response>): Promise<T> => {
  const response = await input;
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? `Report API returned ${response.status}.`);
  return body;
};

const send = <T>(url: string, method: string, body?: unknown) =>
  json<T>(
    fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

export const reportInstanceStore = {
  lastId: () => localStorage.getItem("lee-report-studio.report-instance.v1") ?? undefined,
  remember: (id: string) =>
    localStorage.setItem("lee-report-studio.report-instance.v1", id),
  forget: () => localStorage.removeItem("lee-report-studio.report-instance.v1"),
  config: () => json<NarrativeConfig>(fetch("/api/narratives/config")),
  create: (instance: ReportInstance) =>
    send<ReportInstance>("/api/report-instances", "POST", instance),
  get: (id: string) =>
    json<ReportInstance>(fetch(`/api/report-instances/${encodeURIComponent(id)}`)),
  save: (instance: ReportInstance) =>
    send<ReportInstance>(
      `/api/report-instances/${encodeURIComponent(instance.id)}`,
      "PUT",
      instance,
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
