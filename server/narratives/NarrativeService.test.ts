import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport.ts";
import { sampleTemplate } from "../../src/data/sampleTemplate.ts";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport.ts";
import type { NarrativeContext } from "../../src/report-engine/narratives/schema.ts";
import { FileSystemReportInstanceRepository } from "../report-instances/FileSystemReportInstanceRepository.ts";
import type { NarrativeModelClient } from "./modelClient.ts";
import { NarrativeService } from "./NarrativeService.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class GroundedClient implements NarrativeModelClient {
  readonly configured = true;
  readonly model = "grounded-test-model";
  constructor(private readonly fail = new Set<string>()) {}
  async generate(context: NarrativeContext) {
    if (this.fail.has(context.marketId)) throw new Error("test failure");
    const vacancy = context.facts.find((item) => item.contextKey === "metric.vacancy.current")!;
    return {
      model: this.model,
      result: {
        narrative: `Vacancy was ${vacancy.displayValue}.`,
        claims: [{ claim: `Vacancy was ${vacancy.displayValue}.`, supportKeys: [vacancy.contextKey], evidenceClass: "direct" as const }],
        contextKeysUsed: [vacancy.contextKey],
        qualityFlags: [],
      },
      usage: { inputTokens: 20, outputTokens: 8 },
    };
  }
}

async function setup(fail = new Set<string>()) {
  const root = await mkdtemp(path.join(tmpdir(), "lee-narratives-"));
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
  return { repository, instance, service: new NarrativeService(repository, new GroundedClient(fail), 3, () => undefined) };
}

describe("NarrativeService", () => {
  it("persists generation, editing, approval, revision history, and usage metadata", async () => {
    const { repository, instance, service } = await setup();
    const generated = await service.generate(instance.id, "overall-market");
    expect(generated.narratives[0]).toMatchObject({ status: "draft", source: "ai", model: "grounded-test-model" });
    expect(generated.narratives[0]!.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
    expect(generated.dataSnapshot.overallMarket.narrative).toBe(
      generated.narratives[0]!.text,
    );
    const centralGenerated = await service.generate(instance.id, "central-dupage");
    expect(
      centralGenerated.dataSnapshot.submarketDetails.find(
        (item) => item.name === "Central DuPage",
      )?.narrative,
    ).toBe(
      centralGenerated.narratives.find(
        (item) => item.marketId === "central-dupage",
      )?.text,
    );
    const edited = await service.edit(instance.id, "overall-market", "Manually reviewed narrative.");
    expect(edited.narratives[0]).toMatchObject({ status: "edited", source: "manual" });
    expect(edited.narratives[0]!.revisions.length).toBeGreaterThan(0);
    const approved = await service.approve(instance.id, "overall-market");
    expect(approved.narratives[0]!.status).toBe("approved");
    expect((await repository.get(instance.id))!.narratives[0]!.status).toBe("approved");
  });

  it("Generate All preserves approved/edited work and retains partial successes", async () => {
    const { repository, instance, service } = await setup(new Set(["ohare"]));
    await service.edit(instance.id, "overall-market", "Approved manual narrative.");
    await service.approve(instance.id, "overall-market");
    await service.edit(instance.id, "central-dupage", "Unapproved manual edit.");
    let job = await service.startGenerateAll(instance.id);
    expect(job.total).toBe(17);
    for (let attempt = 0; attempt < 1_000 && job.status !== "complete"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = service.job(job.id);
    }
    const saved = (await repository.get(instance.id))!;
    expect(job.status).toBe("complete");
    expect(job.failed).toBe(1);
    expect(saved.narratives.find((item) => item.marketId === "overall-market")?.status).toBe("approved");
    expect(saved.narratives.find((item) => item.marketId === "central-dupage")?.status).toBe("edited");
    expect(saved.narratives.find((item) => item.marketId === "ohare")?.status).toBe("failed");
    expect(saved.narratives.filter((item) => item.status === "draft")).toHaveLength(16);
  });

  it("marks approved text stale after relevant normalized context changes", async () => {
    const { repository, instance, service } = await setup();
    await service.generate(instance.id, "overall-market");
    const approved = await service.approve(instance.id, "overall-market");
    const originalText = approved.narratives[0]!.text;
    const changed = structuredClone(approved);
    changed.dataSnapshot.overallMarket.vacancyRate += 0.01;
    await repository.save(changed);
    const refreshed = await service.refreshStaleness(instance.id);
    expect(refreshed.narratives[0]).toMatchObject({ status: "stale", text: originalText });
    expect(refreshed.readiness.canPublish).toBe(false);
  });

  it("isolates narrative edits between report instances", async () => {
    const { repository, instance, service } = await setup();
    const second = structuredClone(instance);
    second.id = `report-${crypto.randomUUID()}`;
    second.dataSnapshot = structuredClone(q2SampleReport);
    await repository.save(second);
    await service.edit(instance.id, "overall-market", "Q2 first report text.");
    expect((await repository.get(second.id))!.narratives[0]!.text).toBe("");
  });
});
