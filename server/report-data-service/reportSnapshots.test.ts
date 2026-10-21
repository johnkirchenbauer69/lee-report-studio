import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport.ts";
import { hashNormalizedReport, FileSystemReportSnapshotStore, prepareSnapshot } from "./reportSnapshots.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("report snapshot hashing", () => {
  it("persists immutable provenance across restarts and rejects tampering", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lee-source-snapshot-"));
    try {
      const snapshot = prepareSnapshot(q2SampleReport, { generatedAt: "2026-10-21T12:00:00Z", provider: "ascendix", mode: "mock",
        reportDefinitionVersion: "test", requestId: "test", recordCounts: {} });
      const store = new FileSystemReportSnapshotStore(root);
      await store.save(snapshot);
      expect(await new FileSystemReportSnapshotStore(root).get(snapshot.id)).toEqual(JSON.parse(JSON.stringify(snapshot)));
      await expect(store.save(snapshot)).rejects.toThrow();
      await expect(store.get("../escape")).rejects.toThrow("Invalid snapshot");
      await writeFile(path.join(root, "report-source-snapshots", `${snapshot.id}.json`), JSON.stringify({ ...snapshot, hash: "wrong" }));
      await expect(store.get(snapshot.id)).rejects.toThrow("integrity");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("is stable for the same canonical payload regardless of object key order", () => {
    const original = structuredClone(q2SampleReport);
    const reordered = {
      ...original,
      report: {
        preparedBy: original.report.preparedBy,
        period: original.report.period,
        market: original.report.market,
        templateId: original.report.templateId,
        title: original.report.title,
        id: original.report.id,
      },
    };
    expect(hashNormalizedReport(original)).toBe(
      hashNormalizedReport(reordered),
    );
  });

  it("changes when normalized report data changes", () => {
    const changed = structuredClone(q2SampleReport);
    changed.submarkets[0].inventorySf += 1;
    expect(hashNormalizedReport(changed)).not.toBe(
      hashNormalizedReport(q2SampleReport),
    );
  });
});
