import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate.ts";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport.ts";
import type { NarrativeContext } from "../../src/report-engine/narratives/schema.ts";
import { FileSystemReportInstanceRepository } from "../report-instances/FileSystemReportInstanceRepository.ts";
import { buildNarrativeContext } from "./contextBuilder.ts";
import { MockNarrativeModelClient } from "./modelClient.ts";
import {
  NarrativeMcpBridgeClient,
  REQUIRED_NARRATIVE_MCP_TOOLS,
  type NarrativeMcpSession,
  type NarrativeMcpSubmittedNarrative,
} from "./NarrativeMcpBridgeClient.ts";
import { NarrativeService } from "./NarrativeService.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * A stand-in for the remote MCP job store. Same contract, no network: it
 * accepts a created job, hands the contexts back, and lets a test submit a
 * batch the way ChatGPT would.
 */
class FakeNarrativeMcp {
  jobs = new Map<string, Record<string, unknown>>();
  createdArgs?: Record<string, unknown>;
  status: "pending" | "claimed" | "complete" | "expired" = "pending";
  private counter = 0;

  session(): NarrativeMcpSession {
    return {
      listTools: async () => ({
        tools: REQUIRED_NARRATIVE_MCP_TOOLS.map((name) => ({ name })),
      }),
      callTool: async (name, args) => {
        if (name === "create_report_studio_narrative_job") {
          this.createdArgs = args;
          const jobId = `job-${++this.counter}`;
          this.jobs.set(jobId, {
            marketIds: args.market_ids,
            contexts: args.contexts,
            narratives: undefined,
          });
          this.status = "pending";
          return {
            structuredContent: {
              ok: true,
              job_id: jobId,
              status: "pending",
              report_instance_id: args.report_instance_id,
              narrative_count: (args.market_ids as string[]).length,
              market_ids: args.market_ids,
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 7_200_000).toISOString(),
            },
          };
        }
        if (name === "get_report_studio_narrative_job") {
          const job = this.jobs.get(args.job_id as string);
          if (!job)
            return {
              structuredContent: {
                ok: false,
                error: `Report Studio narrative job ${args.job_id} was not found.`,
              },
              isError: true,
            };
          const contexts = job.contexts as { marketId: string; contextHash: string }[];
          return {
            structuredContent: {
              ok: true,
              job_id: args.job_id,
              status: this.status,
              required_market_ids: job.marketIds,
              narrative_count: (job.marketIds as string[]).length,
              context_hashes: Object.fromEntries(
                contexts.map((context) => [context.marketId, context.contextHash]),
              ),
              ...(this.status === "complete"
                ? { narratives: job.narratives, completed_at: new Date().toISOString() }
                : {}),
            },
          };
        }
        return { structuredContent: { ok: false, error: "unexpected" }, isError: true };
      },
      close: async () => undefined,
    };
  }

  /** What ChatGPT would do: write the batch and submit it. */
  complete(jobId: string, narratives: NarrativeMcpSubmittedNarrative[]) {
    this.jobs.get(jobId)!.narratives = narratives;
    this.status = "complete";
  }

  expire() {
    this.status = "expired";
  }
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "lee-external-narratives-"));
  roots.push(root);
  const repository = new FileSystemReportInstanceRepository(root);
  const instance = await generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
  await repository.save(instance);
  const mcp = new FakeNarrativeMcp();
  const bridge = new NarrativeMcpBridgeClient({
    url: "https://mcp.test/mcp",
    chatGptAppUrl: "https://chatgpt.test/app",
    pollIntervalMs: 10,
    healthCacheMs: 0,
    sessionFactory: async () => mcp.session(),
  });
  const service = new NarrativeService(
    repository,
    new MockNarrativeModelClient(),
    3,
    () => undefined,
    { mode: "chatgpt_mcp", bridge },
  );
  return { repository, instance, service, mcp };
}

/** A narrative grounded in the market's real current context. */
function grounded(
  context: NarrativeContext,
  overrides: Partial<NarrativeMcpSubmittedNarrative> = {},
): NarrativeMcpSubmittedNarrative {
  const vacancy = context.facts.find(
    (item) => item.contextKey === "metric.vacancy.current",
  )!;
  return {
    marketId: context.marketId,
    narrative: `Vacancy finished the quarter at ${vacancy.displayValue}.`,
    claims: [
      {
        claim: `Vacancy finished the quarter at ${vacancy.displayValue}.`,
        supportKeys: [vacancy.contextKey],
        evidenceClass: "direct",
      },
    ],
    contextKeysUsed: [vacancy.contextKey],
    qualityFlags: [],
    promptVersion: context.promptVersion,
    ...overrides,
  };
}

describe("ChatGPT MCP narrative generation", () => {
  it("reports ready without an OpenAI API key when the bridge is healthy", async () => {
    const { service } = await setup();
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const config = await service.config();
      expect(config.configured).toBe(true);
      expect(config.message).toBe("ChatGPT narrative generation is ready.");
      expect(config.mode).toBe("chatgpt_mcp");
      expect(config.model).toBe("chatgpt-mcp");
      expect(config.chatGptAppUrl).toBe("https://chatgpt.test/app");
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
    }
  });

  it("reports the bridge unavailable when the remote cannot be reached", async () => {
    const { repository, service: _service } = await setup();
    const service = new NarrativeService(
      repository,
      new MockNarrativeModelClient(),
      3,
      () => undefined,
      {
        mode: "chatgpt_mcp",
        bridge: new NarrativeMcpBridgeClient({
          url: "https://mcp.test/mcp",
          healthCacheMs: 0,
          sessionFactory: async () => {
            throw new Error("fetch failed");
          },
        }),
      },
    );
    const config = await service.config();
    expect(config.configured).toBe(false);
    expect(config.message).toBe("LEE Intelligence MCP narrative bridge is unavailable.");
  });

  it("sends 19 publication-safe contexts and parks the report waiting for ChatGPT", async () => {
    const { instance, service, mcp } = await setup();
    const started = await service.startExternalGeneration(instance.id);
    const job = started.externalNarrativeJob!;
    expect(job.provider).toBe("chatgpt_mcp");
    expect(job.status).toBe("waiting_for_chatgpt");
    expect(job.marketIds).toHaveLength(19);
    expect(job.generationScope).toBe("all");
    expect(job.appUrl).toBe("https://chatgpt.test/app");
    expect(job.handoffPrompt).toContain(job.jobId);
    expect(Object.keys(job.contextHashes ?? {})).toHaveLength(19);

    const contexts = mcp.createdArgs!.contexts as Record<string, unknown>[];
    expect(contexts).toHaveLength(19);
    expect(mcp.createdArgs!.generation_scope).toBe("all");
    expect(mcp.createdArgs!.template_version).toBe(instance.templateVersion);
    // No server-only provenance and no raw Salesforce identifiers leave here.
    const serialized = JSON.stringify(contexts);
    expect(serialized).not.toContain("internalSourceIds");
    expect(serialized).not.toMatch(/\b[a-zA-Z0-9]{18}\b/);
  });

  it("imports a valid batch as 19 Draft narratives with chatgpt-mcp provenance", async () => {
    const { repository, instance, service, mcp } = await setup();
    const started = await service.startExternalGeneration(instance.id);
    const job = started.externalNarrativeJob!;
    mcp.complete(
      job.jobId,
      job.marketIds.map((marketId) =>
        grounded(buildNarrativeContext({ reportInstance: started, marketId })),
      ),
    );

    const state = await service.externalJobState(instance.id);
    expect(state.job?.status).toBe("complete");
    expect(state.job?.importedAt).toBeTruthy();
    const drafts = state.instance.narratives.filter((item) => item.status === "draft");
    expect(drafts).toHaveLength(19);
    for (const record of drafts) {
      expect(record.source).toBe("ai");
      expect(record.model).toBe("chatgpt-mcp");
      expect(record.contextHash).toBeTruthy();
      expect(record.claims.length).toBeGreaterThan(0);
      expect(record.wordCount).toBeGreaterThan(0);
    }
    // Narrative text is bound into the presentation snapshot for the PDF.
    expect(state.instance.dataSnapshot.overallMarket.narrative).toBe(
      state.instance.narratives.find((item) => item.marketId === "overall-market")!.text,
    );
    expect((await repository.get(instance.id))!.narratives.filter((item) => item.status === "draft")).toHaveLength(19);
  });

  it("stays waiting while ChatGPT has not submitted", async () => {
    const { instance, service } = await setup();
    await service.startExternalGeneration(instance.id);
    const state = await service.externalJobState(instance.id);
    expect(state.job?.status).toBe("waiting_for_chatgpt");
    expect(state.instance.narratives.every((item) => item.status === "not_generated")).toBe(true);
  });

  it("marks the job expired when the remote job lapses", async () => {
    const { instance, service, mcp } = await setup();
    await service.startExternalGeneration(instance.id);
    mcp.expire();
    const state = await service.externalJobState(instance.id);
    expect(state.job?.status).toBe("expired");
    expect(state.job?.error).toMatch(/expired/i);
    expect(state.instance.narratives.every((item) => item.status === "not_generated")).toBe(true);
  });

  it("holds back approved and edited narratives from Generate All", async () => {
    const { instance, service, mcp } = await setup();
    await service.edit(instance.id, "overall-market", "An approved manual narrative.");
    await service.approve(instance.id, "overall-market");
    await service.edit(instance.id, "central-dupage", "An unapproved manual edit.");
    const started = await service.startExternalGeneration(instance.id);
    const marketIds = started.externalNarrativeJob!.marketIds;
    expect(marketIds).toHaveLength(17);
    expect(marketIds).not.toContain("overall-market");
    expect(marketIds).not.toContain("central-dupage");
    expect(mcp.createdArgs!.generation_scope).toBe("selected");
  });

  it("regenerates a single market through the same job mechanism", async () => {
    const { instance, service, mcp } = await setup();
    const started = await service.startExternalGeneration(instance.id, {
      marketIds: ["central-dupage"],
      instruction: "Emphasize leasing activity.",
    });
    const job = started.externalNarrativeJob!;
    expect(job.marketIds).toEqual(["central-dupage"]);
    expect(job.generationScope).toBe("selected");
    expect(mcp.createdArgs!.editorial_instruction).toBe("Emphasize leasing activity.");
    expect(mcp.createdArgs!.market_ids).toEqual(["central-dupage"]);

    mcp.complete(job.jobId, [
      grounded(buildNarrativeContext({ reportInstance: started, marketId: "central-dupage" })),
    ]);
    const state = await service.externalJobState(instance.id);
    expect(
      state.instance.narratives.find((item) => item.marketId === "central-dupage")!.status,
    ).toBe("draft");
    expect(state.instance.narratives.filter((item) => item.status === "draft")).toHaveLength(1);
  });

  describe("local validation stays authoritative", () => {
    const reject = async (
      mutate: (batch: NarrativeMcpSubmittedNarrative[], started: Awaited<ReturnType<NarrativeService["startExternalGeneration"]>>) => NarrativeMcpSubmittedNarrative[],
      expected: RegExp,
    ) => {
      const { instance, service, mcp } = await setup();
      const started = await service.startExternalGeneration(instance.id, {
        marketIds: ["central-dupage", "ohare"],
      });
      const job = started.externalNarrativeJob!;
      const batch = job.marketIds.map((marketId) =>
        grounded(buildNarrativeContext({ reportInstance: started, marketId })),
      );
      mcp.complete(job.jobId, mutate(batch, started));
      const state = await service.externalJobState(instance.id);
      expect(state.job?.status).toBe("failed");
      expect(state.job?.error).toMatch(
        /ChatGPT returned a batch that failed Report Studio grounding validation/,
      );
      expect(state.job?.error).toMatch(expected);
      // Atomic: nothing imported, existing narratives untouched.
      expect(state.instance.narratives.filter((item) => item.status === "draft")).toHaveLength(0);
      return state;
    };

    it("accepts a valid batch", async () => {
      const { instance, service, mcp } = await setup();
      const started = await service.startExternalGeneration(instance.id, {
        marketIds: ["ohare"],
      });
      const job = started.externalNarrativeJob!;
      mcp.complete(job.jobId, [
        grounded(buildNarrativeContext({ reportInstance: started, marketId: "ohare" })),
      ]);
      const state = await service.externalJobState(instance.id);
      expect(state.job?.status).toBe("complete");
    });

    it("rejects a bad support key", () =>
      reject(
        (batch) =>
          batch.map((item, index) =>
            index === 0
              ? { ...item, claims: [{ ...item.claims[0]!, supportKeys: ["metric.invented.key"] }] }
              : item,
          ),
        /support key metric\.invented\.key is not present/i,
      ));

    it("rejects a hallucinated named entity", () =>
      reject(
        (batch) =>
          batch.map((item, index) =>
            index === 0
              ? { ...item, narrative: `${item.narrative} Fictitious Logistics Group expanded.` }
              : item,
          ),
        /Named entity/i,
      ));

    it("rejects an unsupported number", () =>
      reject(
        (batch) =>
          batch.map((item, index) =>
            index === 0 ? { ...item, narrative: "Vacancy finished the quarter at 87.3%." } : item,
          ),
        /not supported by the trusted context/i,
      ));

    it("rejects a raw Salesforce identifier", () =>
      reject(
        (batch) =>
          batch.map((item, index) =>
            index === 0
              ? { ...item, narrative: `${item.narrative} See a0B5f000001AbCdEAK.` }
              : item,
          ),
        /raw Salesforce record identifier/i,
      ));

    it("rejects an over-length narrative", () =>
      reject(
        (batch) =>
          batch.map((item, index) =>
            index === 0 ? { ...item, narrative: `${"vacancy ".repeat(200)}held.` } : item,
          ),
        /hard maximum is 160/i,
      ));

    it("rejects a market that was not requested", () =>
      reject(
        (batch, started) => [
          ...batch,
          grounded(buildNarrativeContext({ reportInstance: started, marketId: "west-cook" })),
        ],
        /west-cook was not requested/i,
      ));

    it("rejects a duplicate market", () =>
      reject((batch) => [...batch, batch[0]!], /returned more than once/i));

    it("rejects a partial batch", () =>
      reject((batch) => [batch[0]!], /is missing from the returned batch/i));

    it("rejects a mismatched prompt version", () =>
      reject(
        (batch) =>
          batch.map((item, index) =>
            index === 0 ? { ...item, promptVersion: "submarket-v9" } : item,
          ),
        /prompt profile submarket-v9/i,
      ));

    it("re-imports a rejected batch that is still held by the MCP", async () => {
      const { instance, service, mcp } = await setup();
      const started = await service.startExternalGeneration(instance.id, {
        marketIds: ["central-dupage", "ohare"],
      });
      const job = started.externalNarrativeJob!;
      const good = job.marketIds.map((marketId) =>
        grounded(buildNarrativeContext({ reportInstance: started, marketId })),
      );
      // First submission is ungrounded and is rejected whole.
      mcp.complete(
        job.jobId,
        good.map((item, index) =>
          index === 0 ? { ...item, narrative: "Vacancy finished the quarter at 87.3%." } : item,
        ),
      );
      const rejected = await service.externalJobState(instance.id);
      expect(rejected.job?.status).toBe("failed");
      expect(rejected.instance.narratives.filter((item) => item.status === "draft")).toHaveLength(0);
      // A failed job is not retried by polling alone.
      expect((await service.externalJobState(instance.id)).job?.status).toBe("failed");

      // The corrected batch is still on the MCP, so no new ChatGPT round trip.
      mcp.complete(job.jobId, good);
      const reimported = await service.retryExternalJobImport(instance.id);
      expect(reimported.externalNarrativeJob?.status).toBe("complete");
      expect(reimported.narratives.filter((item) => item.status === "draft")).toHaveLength(2);
    });

    it("refuses to re-import a job ChatGPT has not submitted", async () => {
      const { instance, service } = await setup();
      await service.startExternalGeneration(instance.id, { marketIds: ["ohare"] });
      await expect(service.retryExternalJobImport(instance.id)).rejects.toThrow(
        /has not submitted/i,
      );
    });

    it("rejects a stale context and marks the market stale for regeneration", async () => {
      const { repository, instance, service, mcp } = await setup();
      const started = await service.startExternalGeneration(instance.id, {
        marketIds: ["ohare"],
      });
      const job = started.externalNarrativeJob!;
      const batch = [
        grounded(buildNarrativeContext({ reportInstance: started, marketId: "ohare" })),
      ];
      // Report data moves while ChatGPT is writing.
      const moved = structuredClone(started);
      const detail = moved.dataSnapshot.submarketDetails.find(
        (item) => item.name === "O'Hare",
      )!;
      detail.metrics!.vacancyRate += 0.37;
      await repository.save(moved);
      mcp.complete(job.jobId, batch);

      const state = await service.externalJobState(instance.id);
      expect(state.job?.status).toBe("failed");
      expect(state.job?.error).toMatch(/source data changed while the narrative was being written/i);
      const ohare = state.instance.narratives.find((item) => item.marketId === "ohare")!;
      expect(ohare.status).toBe("stale");
      expect(ohare.text).toBe("");
    });
  });
});
