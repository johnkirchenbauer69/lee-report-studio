import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate.ts";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport.ts";
import {
  transportPromptVersion,
  type NarrativeContext,
} from "../../src/report-engine/narratives/schema.ts";
import {
  narrativeRevision,
  narrativeSnapshotIssues,
} from "../../src/report-engine/narratives/workflow.ts";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import { FileSystemReportInstanceRepository } from "../report-instances/FileSystemReportInstanceRepository.ts";
import {
  buildNarrativeContext,
  narrativeReportDataFingerprint,
} from "./contextBuilder.ts";
import { planExternalBatchImport } from "./externalBatchImport.ts";
import type { NarrativeModelClient } from "./modelClient.ts";
import { NarrativeService } from "./NarrativeService.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const groundedResult = (context: NarrativeContext) => {
  const vacancy = context.facts.find(
    (item) => item.contextKey === "metric.vacancy.current",
  )!;
  return {
    narrative: `Demand held steady as vacancy reached ${vacancy.displayValue}.`,
    claims: [
      {
        claim: `Vacancy reached ${vacancy.displayValue}.`,
        supportKeys: [vacancy.contextKey],
        evidenceClass: "direct" as const,
      },
    ],
    contextKeysUsed: [vacancy.contextKey],
    qualityFlags: [],
  };
};

class GroundedClient implements NarrativeModelClient {
  readonly configured = true;
  readonly model = "grounded-test-model";
  /** Runs while the "model" is writing, to simulate concurrent data changes. */
  duringGeneration?: () => Promise<void>;
  async generate(context: NarrativeContext) {
    await this.duringGeneration?.();
    return { model: this.model, result: groundedResult(context) };
  }
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "lee-narrative-snapshot-"));
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
  const client = new GroundedClient();
  const service = new NarrativeService(repository, client, 3, () => undefined);
  return { repository, instance, service, client };
}

const record = (instance: ReportInstance, marketId: string) =>
  instance.narratives.find((item) => item.marketId === marketId)!;

describe("narrative snapshot binding and staleness", () => {
  it("binds a generated narrative to the exact report data fingerprint", async () => {
    const { instance, service } = await setup();
    const generated = await service.generate(instance.id, "overall-market");
    const overall = record(generated, "overall-market");
    expect(overall.status).toBe("draft");
    expect(overall.reportDataFingerprint).toBe(
      narrativeReportDataFingerprint(generated),
    );
    expect(overall.contextHash).toBe(
      buildNarrativeContext({ reportInstance: generated, marketId: "overall-market" }).contextHash,
    );
  });

  it("marks an approved narrative stale after the underlying data changes", async () => {
    const { repository, instance, service } = await setup();
    await service.generate(instance.id, "central-dupage");
    const approved = await service.approve(instance.id, "central-dupage");
    expect(record(approved, "central-dupage").status).toBe("approved");
    await repository.update(instance.id, (current) => {
      const next = structuredClone(current);
      next.dataSnapshot.submarketDetails.find((item) => item.name === "Central DuPage")!.metrics.vacancyRate += 0.01;
      return next;
    });
    const refreshed = await service.refreshStaleness(instance.id);
    expect(record(refreshed, "central-dupage").status).toBe("stale");
    expect(record(refreshed, "central-dupage").approvedAt).toBeUndefined();
    expect(refreshed.readiness.canPublish).toBe(false);
    expect(refreshed.readiness.blockers.map((issue) => issue.message)).toContain(
      "Central DuPage narrative is stale because source data changed.",
    );
  });

  it("marks a narrative stale when a data-bearing page override changes what the reader sees", async () => {
    const { repository, instance, service } = await setup();
    await service.generate(instance.id, "overall-market");
    await service.approve(instance.id, "overall-market");
    // The governed context is untouched, but the Market Totals row now
    // shows a different sales figure than the narrative was reviewed against.
    await repository.update(instance.id, (current) => ({
      ...current,
      manualOverrides: [
        ...current.manualOverrides,
        {
          elementId: "overall-submarket-table",
          bindingPath: "submarketTableRows",
          generatedValue: "$1.24 billion",
          overrideValue: "$1.31 billion",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    }));
    const refreshed = await service.refreshStaleness(instance.id);
    expect(record(refreshed, "overall-market").status).toBe("stale");
  });

  it("keeps contextHash-only staleness for records created before snapshot binding", async () => {
    const { repository, instance, service } = await setup();
    await service.generate(instance.id, "overall-market");
    await repository.update(instance.id, (current) => ({
      ...current,
      narratives: current.narratives.map((item) =>
        item.marketId === "overall-market"
          ? { ...item, reportDataFingerprint: undefined }
          : item,
      ),
      manualOverrides: [
        ...current.manualOverrides,
        {
          elementId: "unrelated",
          bindingPath: "reportDisplay.period",
          generatedValue: "Q2 2026",
          overrideValue: "Second Quarter 2026",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    }));
    const refreshed = await service.refreshStaleness(instance.id);
    expect(record(refreshed, "overall-market").status).toBe("draft");
  });

  it("refuses to approve against moved data and marks the record stale instead", async () => {
    const { repository, instance, service } = await setup();
    await service.generate(instance.id, "overall-market");
    await repository.update(instance.id, (current) => {
      const next = structuredClone(current);
      next.dataSnapshot.sales[0]!.price += 5_000_000;
      return next;
    });
    const attempted = await service.approve(instance.id, "overall-market");
    expect(record(attempted, "overall-market").status).toBe("stale");
  });

  it("marks a completed AI result stale when data moved while it was being generated", async () => {
    const { repository, instance, service, client } = await setup();
    client.duringGeneration = async () => {
      await repository.update(instance.id, (current) => {
        const next = structuredClone(current);
        next.dataSnapshot.overallMarket.vacancyRate += 0.02;
        return next;
      });
    };
    const completed = await service.generate(instance.id, "overall-market");
    const overall = record(completed, "overall-market");
    expect(overall.status).toBe("stale");
    expect(overall.error).toMatch(/changed while this narrative was being generated/i);
    expect(completed.readiness.canPublish).toBe(false);
  });
});

describe("narrativeSnapshotIssues (export integrity)", () => {
  const approvedInstance = async () => {
    const { instance, service } = await setup();
    await service.generate(instance.id, "overall-market");
    return service.approve(instance.id, "overall-market");
  };

  it("passes when page text, record, and snapshot agree", async () => {
    const instance = await approvedInstance();
    expect(narrativeSnapshotIssues(instance)).toEqual([]);
  });

  it("blocks when the report page would print different text than the reviewed narrative", async () => {
    const instance = await approvedInstance();
    instance.dataSnapshot.overallMarket.narrative = "Text from another snapshot.";
    expect(narrativeSnapshotIssues(instance)).toContainEqual(
      expect.objectContaining({
        level: "blocking",
        message: "Overall Market narrative on the report page does not match the reviewed narrative.",
      }),
    );
  });

  it("blocks an exact snapshot hash mismatch between the narrative and the report", async () => {
    const instance = await approvedInstance();
    instance.sourceSnapshotHash = "a-different-provider-snapshot";
    expect(narrativeSnapshotIssues(instance)).toContainEqual(
      expect.objectContaining({
        level: "blocking",
        message: "Overall Market narrative was written against a different report data snapshot. Regenerate it.",
      }),
    );
  });

  it("blocks a manual page override of narrative text, which would bypass review", async () => {
    const instance = await approvedInstance();
    instance.manualOverrides.push({
      elementId: "overview-narrative",
      bindingPath: "overallMarket.narrative",
      generatedValue: "Reviewed text.",
      overrideValue: "Unreviewed text.",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(narrativeSnapshotIssues(instance).some((issue) => issue.level === "blocking")).toBe(true);
  });
});

describe("external batch import snapshot checks", () => {
  it("rejects a batch whose report data snapshot moved even when the market's context did not", async () => {
    const { instance } = await setup();
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const plan = planExternalBatchImport({
      narratives: [
        {
          marketId: "central-dupage",
          promptVersion: transportPromptVersion("submarket"),
          ...groundedResult(context),
        },
      ],
      requestedMarketIds: ["central-dupage"],
      jobContextHashes: { "central-dupage": context.contextHash },
      currentRecord: (marketId) => record(instance, marketId),
      currentContext: () => context,
      reportDataHash: instance.sourceSnapshotHash ?? "",
      jobReportDataFingerprint: "fingerprint-at-job-creation",
      currentReportDataFingerprint: "fingerprint-now",
      revision: narrativeRevision,
    });
    expect(plan.ok).toBe(false);
    expect(plan.staleMarketIds).toEqual(["central-dupage"]);
    expect(plan.failures[0]?.message).toMatch(/different report data snapshot/);
  });

  it("imports a matching batch and records the snapshot fingerprint (transport unchanged)", async () => {
    const { instance } = await setup();
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const fingerprint = narrativeReportDataFingerprint(instance);
    const plan = planExternalBatchImport({
      narratives: [
        {
          marketId: "central-dupage",
          promptVersion: transportPromptVersion("submarket"),
          ...groundedResult(context),
        },
      ],
      requestedMarketIds: ["central-dupage"],
      jobContextHashes: { "central-dupage": context.contextHash },
      remoteContextHashes: { "central-dupage": context.contextHash },
      currentRecord: (marketId) => record(instance, marketId),
      currentContext: () => context,
      reportDataHash: instance.sourceSnapshotHash ?? "",
      jobReportDataHash: instance.sourceSnapshotHash,
      jobReportDataFingerprint: fingerprint,
      currentReportDataFingerprint: fingerprint,
      revision: narrativeRevision,
    });
    expect(plan.ok).toBe(true);
    expect(plan.records[0]).toMatchObject({
      status: "draft",
      promptVersion: "submarket-v3",
      contextHash: context.contextHash,
      reportDataFingerprint: fingerprint,
    });
  });

  it("rejects a batch that echoes a non-transport prompt version", async () => {
    const { instance } = await setup();
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const plan = planExternalBatchImport({
      narratives: [
        { marketId: "central-dupage", promptVersion: "submarket-v9", ...groundedResult(context) },
      ],
      requestedMarketIds: ["central-dupage"],
      jobContextHashes: { "central-dupage": context.contextHash },
      currentRecord: (marketId) => record(instance, marketId),
      currentContext: () => context,
      reportDataHash: "",
      revision: narrativeRevision,
    });
    expect(plan.failures[0]?.kind).toBe("prompt_version");
  });
});
