import "dotenv/config";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { generateReportInstance } from "../src/report-engine/generation/generateReport.ts";
import { CHICAGO_SUBMARKETS } from "../src/report-engine/submarkets.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { looksLikeSalesforceId } from "../src/shared/salesforceIds.ts";
import type { StoredTemplateVersion, TemplateVersionSummary } from "../src/types/templateLibrary.ts";
import { FileSystemReportInstanceRepository } from "../server/report-instances/FileSystemReportInstanceRepository.ts";
import { NarrativeService } from "../server/narratives/NarrativeService.ts";
import {
  MockNarrativeModelClient,
  OpenAINarrativeModelClient,
} from "../server/narratives/modelClient.ts";
import { buildNarrativeContext, publicNarrativeContext } from "../server/narratives/contextBuilder.ts";

const api = process.env.LEE_API_URL ?? "http://127.0.0.1:8787";
const responseJson = async <T>(response: Response) => {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
};
const templates = await responseJson<{ templates: TemplateVersionSummary[] }>(
  await fetch(`${api}/api/templates`),
);
const summary = templates.templates.find(
  (item) => item.id === "industrial-market-report" && item.version === "1.8.0",
);
if (!summary) throw new Error("Working Master Template v1.8.0 was not found.");
if (summary.status !== "draft")
  throw new Error(`v1.8.0 is ${summary.status}; acceptance will not mutate an immutable template.`);
const stored = await responseJson<StoredTemplateVersion>(
  await fetch(`${api}/api/templates/${summary.id}/versions/${summary.version}`),
);
const request = {
  templateId: stored.id,
  templateVersion: stored.version,
  templateChecksum: stored.checksum,
  market: "Chicago",
  period: "2026 Q2",
  calculationScope: { type: "all-submarkets" as const },
  pageSelection: { submarketIds: CHICAGO_SUBMARKETS.map((item) => item.id) },
  source: { provider: "ascendix" as const },
};
const instance = await generateReportInstance(stored.template, request);
if (instance.pages.length !== 44 || instance.narratives.length !== 19)
  throw new Error(`Expected 44 pages and 19 narratives; received ${instance.pages.length} and ${instance.narratives.length}.`);

const root = await mkdtemp(path.join(tmpdir(), "lee-narrative-acceptance-"));
try {
  const repository = new FileSystemReportInstanceRepository(root);
  await repository.save(instance);
  const live = process.env.NARRATIVE_ACCEPTANCE_LIVE_AI === "1";
  const openai = new OpenAINarrativeModelClient();
  if (live && !openai.configured) {
    console.log(JSON.stringify({
      result: "skipped",
      reason: "OPENAI_API_KEY is not configured.",
      templateVersion: stored.version,
      templateStatus: stored.status,
    }, null, 2));
    process.exit(0);
  }
  const model = live ? openai : new MockNarrativeModelClient();
  const service = new NarrativeService(repository, model, 3, () => undefined);
  let pdfOutput: string | undefined;
  const qaMarkets = ["overall-market", "central-dupage", "i80-joliet", "ohare"];
  const contexts = qaMarkets.map((marketId) =>
    buildNarrativeContext({ reportInstance: instance, marketId }),
  );
  contexts.forEach((context) => {
    const containsId = (value: unknown): boolean => {
      if (typeof value === "string")
        return value
          .split(/[^a-zA-Z0-9]+/)
          .some((token) => looksLikeSalesforceId(token));
      if (Array.isArray(value)) return value.some(containsId);
      return Boolean(
        value &&
          typeof value === "object" &&
          Object.values(value as Record<string, unknown>).some(containsId),
      );
    };
    if (containsId(publicNarrativeContext(context)))
      throw new Error(`${context.marketName} client context leaked a Salesforce ID.`);
  });

  const targets = live && process.env.NARRATIVE_ACCEPTANCE_ALL !== "1"
    ? qaMarkets.slice(0, 3)
    : instance.narratives.map((item) => item.marketId);
  for (const marketId of targets) await service.generate(instance.id, marketId);
  let completed = (await repository.get(instance.id))!;
  const failures = completed.narratives.filter(
    (record) => targets.includes(record.marketId) && record.status === "failed",
  );
  if (failures.length)
    throw new Error(
      failures.map((record) => `${record.marketName}: ${record.error}`).join("\n"),
    );
  if (!live || process.env.NARRATIVE_ACCEPTANCE_ALL === "1") {
    for (const record of completed.narratives)
      completed = await service.approve(instance.id, record.marketId);
    if (!completed.readiness.canPublish)
      throw new Error(
        `Approved fixture still has publication blockers: ${completed.readiness.blockers.map((item) => item.message).join("; ")}`,
      );
    const presentation = buildPresentationModel(completed.dataSnapshot);
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
          name: "2026 Q2 Chicago Industrial Market Report - Narrative Acceptance",
          pages: completed.pages,
        },
        data: presentation,
        title: "2026 Q2 Chicago Industrial Market Report",
      }),
    });
    if (!pdfResponse.ok)
      throw new Error(
        `Narrative PDF render failed: ${pdfResponse.status} ${await pdfResponse.text()}`,
      );
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const pdf = await PDFDocument.load(pdfBytes);
    if (pdf.getPageCount() !== 44)
      throw new Error(
        `Expected a 44-page narrative PDF; received ${pdf.getPageCount()}.`,
      );
    const output =
      process.env.LEE_NARRATIVE_ACCEPT_PDF_OUTPUT ??
      "output/pdf/chicago-industrial-market-report-q2-2026-narrative-acceptance.pdf";
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, pdfBytes);
    pdfOutput = output;
  }

  const summarize = (context: (typeof contexts)[number]) => ({
    market: context.marketName,
    contextHash: context.contextHash,
    metrics: context.facts.filter((item) => item.category === "metric").map((item) => `${item.label}: ${item.displayValue}`),
    qoqDeltas: context.facts.filter((item) => item.category === "trend" && item.contextKey.startsWith("metric.")).map((item) => `${item.label}: ${item.displayValue}`),
    rankings: context.facts.filter((item) => item.category === "ranking").slice(0, 6).map((item) => item.displayValue),
    counts: Object.fromEntries(
      ["driver", "lease", "sale", "availability", "construction", "delivery"].map((category) => [category, context.facts.filter((item) => item.category === category).length]),
    ),
  });
  const overall = completed.narratives.find((item) => item.marketId === "overall-market");
  const central = completed.narratives.find((item) => item.marketId === "central-dupage");
  console.log(JSON.stringify({
    result: "passed",
    provider: live ? "openai" : "deterministic-mock",
    model: model.model,
    templateVersion: stored.version,
    templateStatus: stored.status,
    templateChecksum: stored.checksum,
    pages: instance.pages.length,
    narratives: instance.narratives.length,
    generated: targets.length,
    approved: completed.narratives.filter((item) => item.status === "approved").length,
    pdfOutput,
    contextQa: contexts.map(summarize),
    examples: {
      overallMarket: overall?.text,
      centralDuPage: central?.text,
    },
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
