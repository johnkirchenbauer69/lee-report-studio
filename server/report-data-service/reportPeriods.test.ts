import { describe, expect, it, vi } from "vitest";
import { MockAscendixReportAdapter } from "../integrations/ascendix/MockAscendixReportAdapter.ts";
import type { AscendixReportAdapter } from "../integrations/ascendix/AscendixReportAdapter.ts";
import { ReportDataService } from "./ReportDataService.ts";
import { InMemoryReportSnapshotStore } from "./reportSnapshots.ts";

describe("report period service", () => {
  it("exposes deterministic mock periods including Q3", async () => {
    const service = new ReportDataService({
      ascendixAdapter: new MockAscendixReportAdapter(),
      snapshotStore: new InMemoryReportSnapshotStore(),
      mode: "mock",
      now: () => new Date("2026-08-20T12:00:00.000Z"),
    });
    await expect(service.getAvailableReportPeriods()).resolves.toMatchObject({
      mode: "mock",
      requiredSubmarketCount: 18,
      periods: [
        { label: "2026 Q3" },
        { label: "2026 Q2" },
        { label: "2026 Q1" },
        { label: "2025 Q4" },
      ],
    });
  });

  it("reuses discovery for 60 seconds and does not cache failures", async () => {
    let now = new Date("2026-08-20T12:00:00.000Z");
    const discover = vi
      .fn()
      .mockRejectedValueOnce(new Error("Salesforce unavailable"))
      .mockResolvedValue([
        { label: "2026 Q3", periodEnd: "2026-09-30", submarketCount: 18 },
      ]);
    const adapter = {
      discoverReportPeriods: discover,
    } as unknown as AscendixReportAdapter;
    const service = new ReportDataService({
      ascendixAdapter: adapter,
      snapshotStore: new InMemoryReportSnapshotStore(),
      mode: "salesforce",
      now: () => now,
    });
    await expect(service.getAvailableReportPeriods()).rejects.toThrow(
      "Salesforce unavailable",
    );
    await service.getAvailableReportPeriods();
    await service.getAvailableReportPeriods();
    expect(discover).toHaveBeenCalledTimes(2);
    now = new Date("2026-08-20T12:01:01.000Z");
    await service.getAvailableReportPeriods();
    expect(discover).toHaveBeenCalledTimes(3);
  });
});
