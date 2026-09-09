import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportRecovery } from "./reportRecovery";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

describe("reportRecovery", () => {
  it("round-trips a revision-aware local recovery document", () => {
    reportRecovery.save({
      reportId: "report-recovery-test",
      baseRevision: 7,
      pages: [],
      manualOverrides: [],
      savedAt: "2026-09-08T10:00:00.000Z",
    });
    expect(reportRecovery.load("report-recovery-test")).toEqual({
      reportId: "report-recovery-test",
      baseRevision: 7,
      pages: [],
      manualOverrides: [],
      savedAt: "2026-09-08T10:00:00.000Z",
    });
    reportRecovery.clear("report-recovery-test");
    expect(reportRecovery.load("report-recovery-test")).toBeUndefined();
  });

  it("ignores malformed recovery state", () => {
    values.set(
      "lee-report-studio.report-recovery.v1.report-recovery-test",
      JSON.stringify({ reportId: "report-recovery-test", pages: "bad" }),
    );
    expect(reportRecovery.load("report-recovery-test")).toBeUndefined();
  });
});
