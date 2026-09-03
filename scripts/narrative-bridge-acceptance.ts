import "dotenv/config";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { PDFDocument } from "pdf-lib";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { generateReportInstance } from "../src/report-engine/generation/generateReport.ts";
import { CHICAGO_SUBMARKETS } from "../src/report-engine/submarkets.ts";
import type { PublicNarrativeContext } from "../src/report-engine/narratives/schema.ts";
import type { StoredTemplateVersion, TemplateVersionSummary } from "../src/types/templateLibrary.ts";
import { NarrativeMcpBridgeClient } from "../server/narratives/NarrativeMcpBridgeClient.ts";
import { NarrativeService } from "../server/narratives/NarrativeService.ts";
import { MockNarrativeModelClient } from "../server/narratives/modelClient.ts";
import { FileSystemReportInstanceRepository } from "../server/report-instances/FileSystemReportInstanceRepository.ts";
import { createMockNarrativeMcp } from "../tests/support/mockNarrativeMcpServer.ts";

/**
 * Deterministic cross-repository acceptance for the ChatGPT/MCP narrative
 * bridge.
 *
 *   Report Studio -> create job on the MCP
 *   MCP           -> stores 19 governed contexts
 *   test client   -> reads the job and submits a valid narrative batch
 *   Report Studio -> polls, imports, re-validates
 *   19 narratives -> Draft -> approved -> 44-page PDF
 *
 * Runs with no OPENAI_API_KEY and no paid model call. By default it starts an
 * in-process mock MCP; point NARRATIVE_BRIDGE_ACCEPTANCE_MCP_URL at a running
 * LEE Intelligence MCP to run the same flow against the real connector.
 */

const api = process.env.LEE_API_URL ?? "http://127.0.0.1:8787";
const externalMcpUrl = process.env.NARRATIVE_BRIDGE_ACCEPTANCE_MCP_URL;

const responseJson = async <T>(response: Response) => {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
};

/** Writes a grounded narrative from the supplied context alone. No model. */
const deterministicNarrative = (context: PublicNarrativeContext) => {
  const vacancy =
    context.facts.find((item) => item.contextKey === "metric.vacancy.current") ??
    context.facts[0]!;
  const absorption = context.facts.find(
    (item) => item.contextKey === "metric.net_absorption.current",
  );
  const supportKeys = [vacancy.contextKey];
  const sentences = [`Vacancy finished the quarter at ${vacancy.displayValue}.`];
  if (absorption) {
    sentences.push(`Quarterly net absorption reached ${absorption.displayValue}.`);
    supportKeys.push(absorption.contextKey);
  }
  sentences.push(
    "Conditions were measured rather than decisive, with results varying by location rather than moving uniformly across the region.",
  );
  return {
    marketId: context.marketId,
    narrative: sentences.join(" "),
    claims: [
      {
        claim: `Vacancy finished the quarter at ${vacancy.displayValue}.`,
        supportKeys,
        evidenceClass: "direct" as const,
      },
    ],
    contextKeysUsed: supportKeys,
    qualityFlags: [] as string[],
    promptVersion: context.promptVersion,
  };
};

const templates = await responseJson<{ templates: TemplateVersionSummary[] }>(
  await fetch(`${api}/api/templates`),
);
const templateVersion = process.env.LEE_ACCEPT_TEMPLATE_VERSION ?? "1.8.0";
const summary = templates.templates.find(
  (item) => item.id === "industrial-market-report" && item.version === templateVersion,
);
if (!summary) throw new Error(`Working Master Template v${templateVersion} was not found.`);
const stored = await responseJson<StoredTemplateVersion>(
  await fetch(`${api}/api/templates/${summary.id}/versions/${summary.version}`),
);

const instance = await generateReportInstance(stored.template, {
  templateId: stored.id,
  templateVersion: stored.version,
  templateChecksum: stored.checksum,
  market: "Chicago",
  period: "2026 Q2",
  calculationScope: { type: "all-submarkets" as const },
  pageSelection: { submarketIds: CHICAGO_SUBMARKETS.map((item) => item.id) },
  // Sample by default so this stays deterministic and Salesforce-free. Set
  // NARRATIVE_BRIDGE_ACCEPTANCE_PROVIDER=ascendix to run the same flow
  // against live report data.
  source: {
    provider: (process.env.NARRATIVE_BRIDGE_ACCEPTANCE_PROVIDER ?? "sample") as
      | "sample"
      | "ascendix",
  },
});
if (instance.pages.length !== 44 || instance.narratives.length !== 19)
  throw new Error(
    `Expected 44 pages and 19 narratives; received ${instance.pages.length} and ${instance.narratives.length}.`,
  );

const mock = externalMcpUrl ? undefined : createMockNarrativeMcp();
const mcpPort = mock ? await mock.listen(0) : 0;
const mcpUrl = externalMcpUrl ?? `http://127.0.0.1:${mcpPort}/mcp`;
const root = await mkdtemp(path.join(tmpdir(), "lee-narrative-bridge-acceptance-"));

try {
  const repository = new FileSystemReportInstanceRepository(root);
  await repository.save(instance);
  const bridge = new NarrativeMcpBridgeClient({
    url: mcpUrl,
    chatGptAppUrl: process.env.NARRATIVE_MCP_CHATGPT_APP_URL,
    pollIntervalMs: 200,
    healthCacheMs: 0,
  });
  const service = new NarrativeService(
    repository,
    new MockNarrativeModelClient(),
    3,
    () => undefined,
    { mode: "chatgpt_mcp", bridge },
  );

  // 1. The bridge, not OPENAI_API_KEY, decides whether generation is live.
  const hadApiKey = Boolean(process.env.OPENAI_API_KEY);
  delete process.env.OPENAI_API_KEY;
  const health = await bridge.health({ force: true });
  if (!health.configured)
    throw new Error(
      `Narrative MCP bridge is not configured: ${health.error ?? `missing ${health.missingTools.join(", ")}`}`,
    );
  const config = await service.config();
  if (!config.configured || config.message !== "ChatGPT narrative generation is ready.")
    throw new Error(`Expected the bridge to report ready; got "${config.message}".`);

  // 2. Report Studio creates the job with 19 publication-safe contexts.
  const started = await service.startExternalGeneration(instance.id);
  const job = started.externalNarrativeJob!;
  if (job.marketIds.length !== 19)
    throw new Error(`Expected 19 requested markets; received ${job.marketIds.length}.`);
  if (job.status !== "waiting_for_chatgpt")
    throw new Error(`Expected waiting_for_chatgpt; received ${job.status}.`);

  // 3. A deterministic client stands in for ChatGPT: read the job over MCP,
  //    write grounded narratives, submit the batch over MCP.
  const chatgpt = new Client({ name: "narrative-bridge-acceptance", version: "1.0.0" });
  await chatgpt.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  const fetched = await chatgpt.callTool({
    name: "get_report_studio_narrative_job",
    arguments: { job_id: job.jobId },
  });
  const jobPayload = fetched.structuredContent as {
    ok: boolean;
    error?: string;
    required_market_ids: string[];
    contexts: PublicNarrativeContext[];
  };
  if (!jobPayload?.ok) throw new Error(`get job failed: ${jobPayload?.error}`);
  if (jobPayload.contexts.length !== 19)
    throw new Error(`MCP returned ${jobPayload.contexts.length} contexts; expected 19.`);
  if (JSON.stringify(jobPayload.contexts).includes("internalSourceIds"))
    throw new Error("MCP job context carries server-only source identifiers.");
  const submitted = await chatgpt.callTool({
    name: "submit_report_studio_narrative_batch",
    arguments: {
      job_id: job.jobId,
      narratives: jobPayload.contexts.map(deterministicNarrative),
    },
  });
  const submitPayload = submitted.structuredContent as { ok: boolean; error?: string; narratives_received?: number };
  if (!submitPayload?.ok) throw new Error(`submit batch failed: ${submitPayload?.error}`);
  await chatgpt.close();

  // 4. Report Studio polls, detects completion, and imports through its own
  //    validators.
  let state = await service.externalJobState(instance.id);
  for (let attempt = 0; attempt < 50 && state.job?.status === "waiting_for_chatgpt"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    state = await service.externalJobState(instance.id);
  }
  if (state.job?.status !== "complete")
    throw new Error(`Import did not complete: ${state.job?.status} ${state.job?.error ?? ""}`);
  const drafts = state.instance.narratives.filter((item) => item.status === "draft");
  if (drafts.length !== 19)
    throw new Error(`Expected 19 Draft narratives; received ${drafts.length}.`);
  if (!drafts.every((item) => item.model === "chatgpt-mcp" && item.source === "ai"))
    throw new Error("Imported narratives are missing chatgpt-mcp provenance.");

  // 5. Approve the fixtures and render the 44-page PDF.
  let approved = state.instance;
  for (const record of approved.narratives)
    approved = await service.approve(instance.id, record.marketId);
  if (!approved.readiness.canPublish)
    throw new Error(
      `Approved fixture still has publication blockers: ${approved.readiness.blockers.map((item) => item.message).join("; ")}`,
    );
  const presentation = buildPresentationModel(approved.dataSnapshot);
  if (!presentation.overallMarket.narrative.trim())
    throw new Error("Overall narrative binding is empty.");
  if (!presentation.submarketDetails.every((detail) => detail.narrative.trim()))
    throw new Error("At least one repeating submarket narrative binding is empty.");

  const pdfResponse = await fetch(`${api}/api/render/pdf`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      template: {
        ...stored.template,
        name: "2026 Q2 Chicago Industrial Market Report - Narrative Bridge Acceptance",
        pages: approved.pages,
      },
      data: presentation,
      title: "2026 Q2 Chicago Industrial Market Report",
    }),
  });
  if (!pdfResponse.ok)
    throw new Error(`Narrative PDF render failed: ${pdfResponse.status} ${await pdfResponse.text()}`);
  const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
  const pdf = await PDFDocument.load(pdfBytes);
  if (pdf.getPageCount() !== 44)
    throw new Error(`Expected a 44-page narrative PDF; received ${pdf.getPageCount()}.`);
  const output =
    process.env.LEE_NARRATIVE_BRIDGE_PDF_OUTPUT ??
    "output/pdf/chicago-industrial-market-report-q2-2026-narrative-bridge-acceptance.pdf";
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, pdfBytes);

  await bridge.close();
  console.log(
    JSON.stringify(
      {
        result: "passed",
        mcp: externalMcpUrl ? "external" : "in-process mock",
        mcpUrl,
        openAiApiKeyPresent: hadApiKey,
        openAiApiKeyUsed: false,
        requiredToolsFound: health.requiredToolsFound,
        remoteToolCount: health.toolCount,
        templateVersion: stored.version,
        templateStatus: stored.status,
        pages: approved.pages.length,
        narrativesRequested: job.marketIds.length,
        narrativesSubmitted: submitPayload.narratives_received,
        draftsImported: drafts.length,
        approved: approved.narratives.filter((item) => item.status === "approved").length,
        canPublish: approved.readiness.canPublish,
        pdfPages: pdf.getPageCount(),
        pdfOutput: output,
        exampleNarrative: approved.narratives[0]!.text,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
  if (mock) await mock.close();
}
