import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import type { PublicNarrativeContext } from "../../src/report-engine/narratives/schema.ts";

/**
 * A faithful stand-in for the LEE Intelligence MCP narrative bridge.
 *
 * It speaks real MCP over Streamable HTTP and implements the same four tools
 * as the production connector, so Report Studio's bridge client is exercised
 * end to end without a network call or a paid model call.
 *
 * Alongside /mcp it exposes a small plain-HTTP control surface that acts as a
 * deterministic ChatGPT: POST /control/jobs/:id/submit reads the stored
 * governed contexts and writes grounded narratives from them.
 */

export interface MockNarrativeJob {
  jobId: string;
  reportInstanceId: string;
  templateVersion: string;
  period: string;
  market: string;
  generationScope: "all" | "selected";
  marketIds: string[];
  contexts: PublicNarrativeContext[];
  editorialInstruction?: string;
  status: "pending" | "claimed" | "complete" | "expired";
  narratives?: unknown[];
  createdAt: string;
  expiresAt: string;
}

export interface MockNarrativeMcpOptions {
  /** Force every job straight to expired, to exercise the expiry path. */
  expireImmediately?: boolean;
  ttlMinutes?: number;
}

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  structuredContent: { ok: false, error: message },
  isError: true,
});

const display = (context: PublicNarrativeContext, key: string) =>
  context.facts.find((item) => item.contextKey === key)?.displayValue;

/**
 * Deterministic grounded narrative built only from the supplied context —
 * the same discipline asked of ChatGPT, with no model involved.
 */
export function deterministicNarrative(context: PublicNarrativeContext) {
  const vacancyFact =
    context.facts.find((item) => item.contextKey === "metric.vacancy.current") ??
    context.facts[0]!;
  const absorption = display(context, "metric.net_absorption.current");
  const supportKeys = [vacancyFact.contextKey];
  const sentences = [
    `Vacancy finished the quarter at ${vacancyFact.displayValue}.`,
  ];
  if (absorption) {
    sentences.push(`Quarterly net absorption reached ${absorption}.`);
    supportKeys.push("metric.net_absorption.current");
  }
  sentences.push(
    "Conditions were measured rather than decisive, with results varying by location rather than moving uniformly.",
  );
  const narrative = sentences.join(" ");
  return {
    marketId: context.marketId,
    narrative,
    claims: [
      {
        claim: `Vacancy finished the quarter at ${vacancyFact.displayValue}.`,
        supportKeys,
        evidenceClass: "direct" as const,
      },
    ],
    contextKeysUsed: supportKeys,
    qualityFlags: [] as string[],
    promptVersion: context.promptVersion,
  };
}

export function createMockNarrativeMcp(options: MockNarrativeMcpOptions = {}) {
  const jobs = new Map<string, MockNarrativeJob>();
  const ttlMinutes = options.ttlMinutes ?? 120;

  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: "mock-lee-intelligence-mcp", version: "1.0.0" },
      { instructions: "Mock LEE Intelligence narrative bridge for tests." },
    );
    server.registerTool(
      "create_report_studio_narrative_job",
      {
        description: "Creates a Report Studio narrative job.",
        inputSchema: {
          report_instance_id: z.string(),
          template_version: z.string(),
          period: z.string(),
          market: z.string(),
          generation_scope: z.enum(["all", "selected"]),
          market_ids: z.array(z.string()),
          report_data_hash: z.string().optional(),
          editorial_instruction: z.string().optional(),
          contexts: z.array(z.any()),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (input) => {
        const contexts = input.contexts as PublicNarrativeContext[];
        if (contexts.length > 19) return fail("A narrative job accepts at most 19 contexts.");
        if (new Set(contexts.map((item) => item.marketId)).size !== contexts.length)
          return fail("Duplicate narrative context market.");
        if (JSON.stringify(contexts).includes("internalSourceIds"))
          return fail("Narrative context carries internalSourceIds.");
        const createdAt = new Date();
        const job: MockNarrativeJob = {
          jobId: randomUUID(),
          reportInstanceId: input.report_instance_id,
          templateVersion: input.template_version,
          period: input.period,
          market: input.market,
          generationScope: input.generation_scope,
          marketIds: input.market_ids,
          contexts,
          editorialInstruction: input.editorial_instruction,
          status: options.expireImmediately ? "expired" : "pending",
          createdAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + ttlMinutes * 60_000).toISOString(),
        };
        jobs.set(job.jobId, job);
        return json({
          ok: true,
          job_id: job.jobId,
          status: job.status,
          report_instance_id: job.reportInstanceId,
          narrative_count: job.marketIds.length,
          market_ids: job.marketIds,
          created_at: job.createdAt,
          expires_at: job.expiresAt,
        });
      },
    );
    server.registerTool(
      "list_pending_report_studio_narrative_jobs",
      {
        description: "Lists pending Report Studio narrative jobs.",
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async () =>
        json({
          ok: true,
          jobs: [...jobs.values()]
            .filter((job) => job.status === "pending" || job.status === "claimed")
            .map((job) => ({
              job_id: job.jobId,
              status: job.status,
              period: job.period,
              market: job.market,
              narrative_count: job.marketIds.length,
              created_at: job.createdAt,
              expires_at: job.expiresAt,
            })),
        }),
    );
    server.registerTool(
      "get_report_studio_narrative_job",
      {
        description: "Returns one Report Studio narrative job and its contexts.",
        inputSchema: { job_id: z.string() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ job_id }) => {
        const job = jobs.get(job_id);
        if (!job) return fail(`Report Studio narrative job ${job_id} was not found.`);
        if (job.status === "pending") job.status = "claimed";
        return json({
          ok: true,
          job_id: job.jobId,
          status: job.status,
          report_instance_id: job.reportInstanceId,
          template_version: job.templateVersion,
          period: job.period,
          market: job.market,
          narrative_count: job.marketIds.length,
          required_market_ids: job.marketIds,
          editorial_instruction: job.editorialInstruction ?? null,
          context_hashes: Object.fromEntries(
            job.contexts.map((context) => [context.marketId, context.contextHash]),
          ),
          contexts: job.contexts,
          created_at: job.createdAt,
          expires_at: job.expiresAt,
          ...(job.status === "complete"
            ? { narratives: job.narratives, completed_at: new Date().toISOString() }
            : {}),
        });
      },
    );
    server.registerTool(
      "submit_report_studio_narrative_batch",
      {
        description: "Submits a completed narrative batch to a Report Studio narrative job.",
        inputSchema: { job_id: z.string(), narratives: z.array(z.any()) },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ job_id, narratives }) => {
        const job = jobs.get(job_id);
        if (!job) return fail(`Report Studio narrative job ${job_id} was not found.`);
        if (job.status === "expired") return fail(`Report Studio narrative job ${job_id} has expired.`);
        job.narratives = narratives as unknown[];
        job.status = "complete";
        return json({
          ok: true,
          job_id: job.jobId,
          status: "complete",
          narratives_received: (narratives as unknown[]).length,
        });
      },
    );
    return server;
  });

  const nodeHandler = toNodeHandler(handler);

  const control = (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === "/control/jobs") return send(200, { jobs: [...jobs.values()] });
    const submit = /^\/control\/jobs\/([^/]+)\/submit$/.exec(url.pathname);
    if (submit && request.method === "POST") {
      const job = jobs.get(decodeURIComponent(submit[1]!));
      if (!job) return send(404, { error: "job not found" });
      // Acts as ChatGPT: writes grounded narratives from the stored contexts.
      job.narratives = job.contexts.map((context) => deterministicNarrative(context));
      job.status = "complete";
      return send(200, { ok: true, narratives_received: job.narratives.length });
    }
    const raw = /^\/control\/jobs\/([^/]+)\/submit-raw$/.exec(url.pathname);
    if (raw && request.method === "POST") {
      const job = jobs.get(decodeURIComponent(raw[1]!));
      if (!job) return send(404, { error: "job not found" });
      // Submits a caller-supplied batch verbatim, so a test can hand back
      // something Report Studio must reject.
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          job.narratives = body.narratives ?? [];
          job.status = "complete";
          send(200, { ok: true, narratives_received: (job.narratives ?? []).length });
        } catch (error) {
          send(400, { error: error instanceof Error ? error.message : String(error) });
        }
      });
      return undefined;
    }
    const expire = /^\/control\/jobs\/([^/]+)\/expire$/.exec(url.pathname);
    if (expire && request.method === "POST") {
      const job = jobs.get(decodeURIComponent(expire[1]!));
      if (!job) return send(404, { error: "job not found" });
      job.status = "expired";
      return send(200, { ok: true });
    }
    return send(404, { error: "not found" });
  };

  const httpServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, jobs: jobs.size }));
      return;
    }
    if (url.pathname.startsWith("/control/")) return control(request, response, url);
    if (url.pathname === "/mcp") {
      void nodeHandler(request, response);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  return {
    jobs,
    httpServer,
    listen: (port: number) =>
      new Promise<number>((resolve) => {
        httpServer.listen(port, "127.0.0.1", () => {
          const address = httpServer.address();
          resolve(typeof address === "object" && address ? address.port : port);
        });
      }),
    close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
  };
}
