import type {
  NarrativeClaim,
  NarrativeQualityFlag,
  PublicNarrativeContext,
} from "../../src/report-engine/narratives/schema.ts";

/**
 * Server-side MCP client for the LEE Intelligence narrative bridge.
 *
 * The browser never speaks MCP. It calls the local Report Studio API, which
 * uses this client to reach the remote MCP over Streamable HTTP:
 *
 *   React browser -> Report Studio API -> NarrativeMcpBridgeClient -> /mcp
 *
 * The remote MCP holds the narrative job because it cannot reach a Report
 * Studio instance on an analyst's own machine. Every hop here is outbound.
 */

export const REQUIRED_NARRATIVE_MCP_TOOLS = [
  "create_report_studio_narrative_job",
  "list_pending_report_studio_narrative_jobs",
  "get_report_studio_narrative_job",
  "submit_report_studio_narrative_batch",
] as const;

export type NarrativeMcpToolName = (typeof REQUIRED_NARRATIVE_MCP_TOOLS)[number];

export interface NarrativeMcpHealth {
  /** A remote MCP URL is set and every required narrative tool was found. */
  configured: boolean;
  reachable: boolean;
  mcpUrl?: string;
  toolCount?: number;
  requiredToolsFound: string[];
  missingTools: string[];
  checkedAt: string;
  error?: string;
}

export interface NarrativeMcpJobSummary {
  jobId: string;
  status: "pending" | "claimed" | "complete" | "failed" | "expired";
  reportInstanceId: string;
  narrativeCount: number;
  marketIds: string[];
  createdAt: string;
  expiresAt: string;
}

export interface NarrativeMcpSubmittedNarrative {
  marketId: string;
  narrative: string;
  claims: NarrativeClaim[];
  contextKeysUsed: string[];
  qualityFlags: NarrativeQualityFlag[];
  promptVersion: string;
}

export interface NarrativeMcpJob extends NarrativeMcpJobSummary {
  period: string;
  market: string;
  templateVersion: string;
  editorialInstruction?: string;
  completedAt?: string;
  /** contextHash the remote holds per market, for cross-checking staleness. */
  contextHashes?: Record<string, string>;
  narratives?: NarrativeMcpSubmittedNarrative[];
}

export interface CreateNarrativeMcpJobInput {
  reportInstanceId: string;
  templateVersion: string;
  period: string;
  market: string;
  generationScope: "all" | "selected";
  marketIds: string[];
  reportDataHash?: string;
  editorialInstruction?: string;
  contexts: PublicNarrativeContext[];
}

/** Minimal MCP surface this client needs. Injectable so tests never dial out. */
export interface NarrativeMcpSession {
  listTools(): Promise<{ tools: { name: string }[] }>;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ structuredContent?: unknown; isError?: boolean }>;
  close(): Promise<void>;
}

export type NarrativeMcpSessionFactory = (url: string) => Promise<NarrativeMcpSession>;

export interface NarrativeMcpBridgeOptions {
  url?: string;
  chatGptAppUrl?: string;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  healthCacheMs?: number;
  sessionFactory?: NarrativeMcpSessionFactory;
  now?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_CACHE_MS = 15_000;

const UNAVAILABLE = "LEE Intelligence MCP narrative bridge is unavailable.";

/** Collapses transport noise into one message the UI can show verbatim. */
export const friendlyBridgeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/not configured/i.test(message))
    return "The LEE Intelligence MCP narrative bridge is not configured.";
  if (/timed out|timeout|ETIMEDOUT|AbortError/i.test(message))
    return "The LEE Intelligence MCP narrative bridge timed out. Please retry.";
  if (/expired/i.test(message)) return message;
  if (/was not found/i.test(message)) return message;
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|Failed to fetch|socket hang up|network/i.test(message))
    return UNAVAILABLE;
  return message;
};

const withTimeout = async <T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const defaultSessionFactory: NarrativeMcpSessionFactory = async (url) => {
  const { Client, StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/client"
  );
  const client = new Client({ name: "lee-report-studio", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return {
    listTools: () => client.listTools(),
    callTool: (name, args) => client.callTool({ name, arguments: args }),
    close: () => client.close(),
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const string = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

export class NarrativeMcpBridgeClient {
  readonly url?: string;
  readonly chatGptAppUrl?: string;
  readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly healthCacheMs: number;
  private readonly sessionFactory: NarrativeMcpSessionFactory;
  private readonly now: () => number;
  private session?: NarrativeMcpSession;
  private connecting?: Promise<NarrativeMcpSession>;
  private cachedHealth?: NarrativeMcpHealth;
  private cachedHealthAt = 0;

  constructor(options: NarrativeMcpBridgeOptions = {}) {
    this.url = options.url?.trim() || undefined;
    this.chatGptAppUrl = options.chatGptAppUrl?.trim() || undefined;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.healthCacheMs = options.healthCacheMs ?? DEFAULT_HEALTH_CACHE_MS;
    this.sessionFactory = options.sessionFactory ?? defaultSessionFactory;
    this.now = options.now ?? (() => Date.now());
  }

  /** A remote MCP URL is set. Says nothing about whether it answers. */
  get hasEndpoint() {
    return Boolean(this.url);
  }

  private async connect() {
    if (!this.url) throw new Error("The narrative MCP bridge is not configured.");
    if (this.session) return this.session;
    this.connecting ??= withTimeout(
      () => this.sessionFactory(this.url!),
      this.requestTimeoutMs,
      "Connecting to the LEE Intelligence MCP",
    )
      .then((session) => {
        this.session = session;
        return session;
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }

  /** Drops the cached session so the next call reconnects. */
  private async disconnect() {
    const session = this.session;
    this.session = undefined;
    if (session) await session.close().catch(() => undefined);
  }

  private async call<T>(name: NarrativeMcpToolName, args: Record<string, unknown>) {
    const invoke = async () => {
      const session = await this.connect();
      return withTimeout(
        () => session.callTool(name, args),
        this.requestTimeoutMs,
        `The ${name} request`,
      );
    };
    let result;
    try {
      result = await invoke();
    } catch (error) {
      // One retry on a dropped session: the remote restarts, and a stale
      // Streamable HTTP session id would otherwise fail every later poll.
      await this.disconnect();
      try {
        result = await invoke();
      } catch (retryError) {
        await this.disconnect();
        throw new Error(friendlyBridgeError(retryError));
      }
    }
    const payload = asRecord(result.structuredContent);
    if (result.isError || payload.ok === false)
      throw new Error(
        friendlyBridgeError(
          new Error(string(payload.error, `The ${name} request failed.`)),
        ),
      );
    return payload as T & Record<string, unknown>;
  }

  async health(options: { force?: boolean } = {}): Promise<NarrativeMcpHealth> {
    const checkedAt = new Date(this.now()).toISOString();
    if (!this.url)
      return {
        configured: false,
        reachable: false,
        requiredToolsFound: [],
        missingTools: [...REQUIRED_NARRATIVE_MCP_TOOLS],
        checkedAt,
        error: "NARRATIVE_MCP_URL is not set.",
      };
    if (
      !options.force &&
      this.cachedHealth &&
      this.now() - this.cachedHealthAt < this.healthCacheMs
    )
      return this.cachedHealth;

    let health: NarrativeMcpHealth;
    try {
      const session = await this.connect();
      const { tools } = await withTimeout(
        () => session.listTools(),
        this.requestTimeoutMs,
        "The narrative MCP tool discovery request",
      );
      const names = new Set(tools.map((tool) => tool.name));
      const found = REQUIRED_NARRATIVE_MCP_TOOLS.filter((tool) => names.has(tool));
      const missing = REQUIRED_NARRATIVE_MCP_TOOLS.filter((tool) => !names.has(tool));
      health = {
        configured: missing.length === 0,
        reachable: true,
        mcpUrl: this.url,
        toolCount: tools.length,
        requiredToolsFound: found,
        missingTools: missing,
        checkedAt,
      };
    } catch (error) {
      await this.disconnect();
      health = {
        configured: false,
        reachable: false,
        mcpUrl: this.url,
        requiredToolsFound: [],
        missingTools: [...REQUIRED_NARRATIVE_MCP_TOOLS],
        checkedAt,
        error: friendlyBridgeError(error),
      };
    }
    this.cachedHealth = health;
    this.cachedHealthAt = this.now();
    return health;
  }

  async createJob(input: CreateNarrativeMcpJobInput): Promise<NarrativeMcpJobSummary> {
    const payload = await this.call("create_report_studio_narrative_job", {
      report_instance_id: input.reportInstanceId,
      template_version: input.templateVersion,
      period: input.period,
      market: input.market,
      generation_scope: input.generationScope,
      market_ids: input.marketIds,
      ...(input.reportDataHash ? { report_data_hash: input.reportDataHash } : {}),
      ...(input.editorialInstruction
        ? { editorial_instruction: input.editorialInstruction }
        : {}),
      contexts: input.contexts,
    });
    const jobId = string(payload.job_id);
    if (!jobId) throw new Error("The narrative MCP did not return a job identifier.");
    return {
      jobId,
      status: (string(payload.status, "pending") as NarrativeMcpJobSummary["status"]),
      reportInstanceId: string(payload.report_instance_id, input.reportInstanceId),
      narrativeCount: Number(payload.narrative_count ?? input.marketIds.length),
      marketIds: Array.isArray(payload.market_ids)
        ? (payload.market_ids as string[])
        : input.marketIds,
      createdAt: string(payload.created_at, new Date(this.now()).toISOString()),
      expiresAt: string(payload.expires_at),
    };
  }

  async getJob(jobId: string): Promise<NarrativeMcpJob> {
    const payload = await this.call("get_report_studio_narrative_job", {
      job_id: jobId,
    });
    const narratives = Array.isArray(payload.narratives)
      ? (payload.narratives as NarrativeMcpSubmittedNarrative[])
      : Array.isArray(asRecord(payload.result).narratives)
      ? (asRecord(payload.result).narratives as NarrativeMcpSubmittedNarrative[])
      : undefined;
    return {
      jobId: string(payload.job_id, jobId),
      status: string(payload.status, "pending") as NarrativeMcpJob["status"],
      reportInstanceId: string(payload.report_instance_id),
      narrativeCount: Number(payload.narrative_count ?? 0),
      marketIds: Array.isArray(payload.required_market_ids)
        ? (payload.required_market_ids as string[])
        : Array.isArray(payload.market_ids)
        ? (payload.market_ids as string[])
        : [],
      period: string(payload.period),
      market: string(payload.market),
      templateVersion: string(payload.template_version),
      editorialInstruction: string(payload.editorial_instruction) || undefined,
      createdAt: string(payload.created_at),
      expiresAt: string(payload.expires_at),
      completedAt: string(payload.completed_at) || undefined,
      contextHashes: payload.context_hashes
        ? (asRecord(payload.context_hashes) as Record<string, string>)
        : undefined,
      narratives,
    };
  }

  async listPendingJobs() {
    const payload = await this.call("list_pending_report_studio_narrative_jobs", {});
    return Array.isArray(payload.jobs) ? (payload.jobs as Record<string, unknown>[]) : [];
  }

  async close() {
    await this.disconnect();
  }
}

/**
 * The line an analyst pastes into ChatGPT. Names the app, the job, and the
 * expected round trip, and nothing else.
 */
export const narrativeHandoffPrompt = (jobId: string) =>
  `Use the LEE Intelligence app to complete Report Studio narrative job ${jobId}. Generate every requested narrative from the governed contexts and submit the finished batch back to the job.`;
