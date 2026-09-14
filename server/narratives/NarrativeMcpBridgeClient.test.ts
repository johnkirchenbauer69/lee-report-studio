import { describe, expect, it, vi } from "vitest";
import {
  NarrativeMcpBridgeClient,
  REQUIRED_NARRATIVE_MCP_TOOLS,
  narrativeHandoffPrompt,
  type NarrativeMcpSession,
} from "./NarrativeMcpBridgeClient.ts";
import {
  NARRATIVE_OUTPUT_CONTRACT_VERSION,
  NARRATIVE_PROMPT_PROFILES,
} from "../../src/report-engine/narratives/schema.ts";

const ALL_TOOLS = [
  ...REQUIRED_NARRATIVE_MCP_TOOLS.map((name) => ({ name })),
  { name: "get_market_snapshot" },
];

const context = (marketId: string) => ({
  marketId,
  marketName: marketId,
  marketKind: "submarket" as const,
  period: "2026 Q2",
  promptVersion:
    NARRATIVE_PROMPT_PROFILES[marketId === "overall-market" ? "overall" : "submarket"].version,
  outputContractVersion: NARRATIVE_OUTPUT_CONTRACT_VERSION,
  promptProfile: {
    ...NARRATIVE_PROMPT_PROFILES[marketId === "overall-market" ? "overall" : "submarket"],
  },
  contextHash: `hash-${marketId}`,
  facts: [
    {
      contextKey: "metric.vacancy.current",
      category: "metric" as const,
      label: "Vacancy",
      value: 5.4,
      displayValue: "5.4%",
      sourceType: "Market_Data__c" as const,
      authority: "Report_Data_Service",
      publicationSafe: true as const,
    },
  ],
});

interface FakeOptions {
  tools?: { name: string }[];
  results?: Record<string, unknown>;
  failConnect?: Error;
  failCall?: Error;
  hang?: boolean;
}

function fakeBridge(options: FakeOptions = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let connects = 0;
  let closes = 0;
  const sessionFactory = async (url: string) => {
    connects += 1;
    if (options.failConnect) throw options.failConnect;
    const session: NarrativeMcpSession = {
      listTools: async () => ({ tools: options.tools ?? ALL_TOOLS }),
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (options.hang) return new Promise(() => {}) as never;
        if (options.failCall) throw options.failCall;
        const result = options.results?.[name];
        if (result === undefined)
          return { structuredContent: { ok: false, error: `no stub for ${name}` }, isError: true };
        return { structuredContent: result };
      },
      close: async () => {
        closes += 1;
      },
    };
    expect(url).toBe("https://mcp.test/mcp");
    return session;
  };
  const client = new NarrativeMcpBridgeClient({
    url: "https://mcp.test/mcp",
    chatGptAppUrl: "https://chatgpt.test/app",
    pollIntervalMs: 1_500,
    requestTimeoutMs: 50,
    healthCacheMs: 0,
    sessionFactory,
  });
  return { client, calls, stats: () => ({ connects, closes }) };
}

describe("NarrativeMcpBridgeClient", () => {
  it("reports health and finds all four required narrative tools", async () => {
    const { client } = fakeBridge();
    const health = await client.health();
    expect(health).toMatchObject({
      configured: true,
      reachable: true,
      mcpUrl: "https://mcp.test/mcp",
      toolCount: 5,
      missingTools: [],
    });
    expect(health.requiredToolsFound).toEqual([...REQUIRED_NARRATIVE_MCP_TOOLS]);
    expect(JSON.stringify(health)).not.toMatch(/api[_-]?key|secret|token/i);
  });

  it("is unconfigured when the remote is missing a required narrative tool", async () => {
    const { client } = fakeBridge({
      tools: [{ name: "create_report_studio_narrative_job" }, { name: "get_market_snapshot" }],
    });
    const health = await client.health();
    expect(health.configured).toBe(false);
    expect(health.reachable).toBe(true);
    expect(health.missingTools).toEqual([
      "list_pending_report_studio_narrative_jobs",
      "get_report_studio_narrative_job",
      "submit_report_studio_narrative_batch",
    ]);
  });

  it("reports an unreachable MCP without throwing", async () => {
    const { client } = fakeBridge({ failConnect: new Error("fetch failed") });
    const health = await client.health();
    expect(health).toMatchObject({ configured: false, reachable: false });
    expect(health.error).toBe("LEE Intelligence MCP narrative bridge is unavailable.");
  });

  it("is unconfigured when no MCP URL is set", async () => {
    const client = new NarrativeMcpBridgeClient({});
    expect(client.hasEndpoint).toBe(false);
    const health = await client.health();
    expect(health).toMatchObject({ configured: false, reachable: false });
    expect(health.missingTools).toHaveLength(4);
  });

  it("creates a job and maps the snake_case MCP payload", async () => {
    const { client, calls } = fakeBridge({
      results: {
        create_report_studio_narrative_job: {
          ok: true,
          job_id: "b6f5a0f8-1f2e-4a3b-9c4d-5e6f7a8b9c0d",
          status: "pending",
          report_instance_id: "report-1",
          narrative_count: 2,
          market_ids: ["overall-market", "ohare"],
          created_at: "2026-09-03T12:00:00.000Z",
          expires_at: "2026-09-03T14:00:00.000Z",
          output_contract_version: NARRATIVE_OUTPUT_CONTRACT_VERSION,
        },
      },
    });
    const job = await client.createJob({
      reportInstanceId: "report-1",
      templateVersion: "1.8.0",
      period: "2026 Q2",
      market: "Chicago",
      generationScope: "selected",
      marketIds: ["overall-market", "ohare"],
      contexts: [context("overall-market"), context("ohare")],
    });
    expect(job).toMatchObject({
      jobId: "b6f5a0f8-1f2e-4a3b-9c4d-5e6f7a8b9c0d",
      status: "pending",
      narrativeCount: 2,
      expiresAt: "2026-09-03T14:00:00.000Z",
    });
    expect(calls[0]!.name).toBe("create_report_studio_narrative_job");
    expect(calls[0]!.args).toMatchObject({
      report_instance_id: "report-1",
      generation_scope: "selected",
      market_ids: ["overall-market", "ohare"],
      output_contract_version: NARRATIVE_OUTPUT_CONTRACT_VERSION,
    });
    expect((calls[0]!.args.contexts as unknown[])).toHaveLength(2);
  });

  it("reads a job that is still waiting", async () => {
    const { client } = fakeBridge({
      results: {
        get_report_studio_narrative_job: {
          ok: true,
          job_id: "job-1",
          status: "claimed",
          report_instance_id: "report-1",
          required_market_ids: ["ohare"],
          narrative_count: 1,
          period: "2026 Q2",
          context_hashes: { ohare: "hash-ohare" },
          output_contract_version: NARRATIVE_OUTPUT_CONTRACT_VERSION,
        },
      },
    });
    const job = await client.getJob("job-1");
    expect(job.status).toBe("claimed");
    expect(job.narratives).toBeUndefined();
    expect(job.contextHashes).toEqual({ ohare: "hash-ohare" });
  });

  it("reads a completed job and its narratives", async () => {
    const { client } = fakeBridge({
      results: {
        get_report_studio_narrative_job: {
          ok: true,
          job_id: "job-1",
          status: "complete",
          required_market_ids: ["ohare"],
          completed_at: "2026-09-03T12:30:00.000Z",
          output_contract_version: NARRATIVE_OUTPUT_CONTRACT_VERSION,
          narratives: [
            {
              marketId: "ohare",
              narrative: "Vacancy finished at 5.4%.",
              claims: [],
              contextKeysUsed: [],
              qualityFlags: [],
              promptVersion: "submarket-v2",
            },
          ],
        },
      },
    });
    const job = await client.getJob("job-1");
    expect(job.status).toBe("complete");
    expect(job.narratives).toHaveLength(1);
    expect(job.completedAt).toBe("2026-09-03T12:30:00.000Z");
  });

  it("surfaces a remote tool error as a plain message", async () => {
    const { client } = fakeBridge({
      results: {
        get_report_studio_narrative_job: {
          ok: false,
          error: "Report Studio narrative job job-9 has expired.",
        },
      },
    });
    await expect(client.getJob("job-9")).rejects.toThrow(/has expired/);
  });

  it("preserves stable structured remote error codes", async () => {
    const { client } = fakeBridge({
      results: {
        get_report_studio_narrative_job: {
          ok: false,
          code: "PROMPT_VERSION_MISMATCH",
          error: "The submitted prompt version is stale.",
        },
      },
    });
    await expect(client.getJob("job-9")).rejects.toThrow(
      /PROMPT_VERSION_MISMATCH: The submitted prompt version is stale/,
    );
  });

  it("fails closed when the remote omits or changes the contract version", async () => {
    const { client } = fakeBridge({
      results: {
        get_report_studio_narrative_job: {
          ok: true,
          job_id: "job-old",
          status: "claimed",
          output_contract_version: "narrative-v1",
        },
      },
    });
    await expect(client.getJob("job-old")).rejects.toThrow(
      /UNSUPPORTED_NARRATIVE_CONTRACT_VERSION.*narrative-v2.*narrative-v1/,
    );
  });

  it("retries once on a dropped session, then reports the bridge unavailable", async () => {
    const { client, stats } = fakeBridge({ failCall: new Error("socket hang up") });
    await expect(client.getJob("job-1")).rejects.toThrow(
      "LEE Intelligence MCP narrative bridge is unavailable.",
    );
    expect(stats().connects).toBe(2);
  });

  it("times out rather than hanging a poll", async () => {
    const { client } = fakeBridge({ hang: true });
    await expect(client.getJob("job-1")).rejects.toThrow(/timed out/i);
  });

  it("names the app and the job in the handoff prompt", () => {
    const prompt = narrativeHandoffPrompt("job-123");
    expect(prompt).toContain("LEE Intelligence");
    expect(prompt).toContain("job-123");
    expect(prompt).toContain("submit the finished batch back to the job");
  });

  it("carries the editorial contract, since the remote tool description lives outside this repo", () => {
    const prompt = narrativeHandoffPrompt("job-123");
    expect(prompt).toMatch(/market thesis/i);
    expect(prompt).toMatch(/narrative hierarchy/i);
    expect(prompt).toMatch(/no repetitive template/i);
    expect(prompt).toMatch(/no internal system, salesforce, ascendix/i);
    expect(prompt).toMatch(/no unsupported causal claims/i);
    expect(prompt).toMatch(/marketId, narrative, claims/i);
    expect(prompt).toMatch(/evidenceClass/i);
    expect(prompt).toMatch(/GET the same job again/i);
  });

  it("bans em dashes and formulaic rhetorical phrasing in the handoff contract", () => {
    const prompt = narrativeHandoffPrompt("job-123");
    expect(prompt).toMatch(/do not use em dashes/i);
    expect(prompt).toMatch(/year-over-year/i);
    expect(prompt).toMatch(/build-to-suit/i);
    expect(prompt).toMatch(/avoid repetitive rhetorical phrasing/i);
  });

  it("does not dial the network when a session factory is injected", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { client } = fakeBridge();
    await client.health();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
