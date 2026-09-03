import { describe, expect, it } from "vitest";
import {
  approveNarrative,
  editNarrative,
  initializeNarratives,
  narrativeReadinessIssues,
  restoreNarrativeRevision,
  unlockNarrative,
} from "./workflow";

describe("narrative workflow", () => {
  it("initializes exactly one Overall plus the canonical 18 submarkets", () => {
    const records = initializeNarratives("2026 Q2", "data-hash");
    expect(records).toHaveLength(19);
    expect(new Set(records.map((item) => item.marketId)).size).toBe(19);
    expect(narrativeReadinessIssues(records)).toHaveLength(19);
  });

  it("requires explicit approval and removes approval after editing", () => {
    const initial = initializeNarratives("2026 Q2", "data-hash")[0]!;
    const edited = editNarrative(initial, "A manually reviewed market narrative.", "2026-09-03T12:00:00.000Z");
    const approved = approveNarrative(edited, "2026-09-03T12:01:00.000Z");
    expect(approved.status).toBe("approved");
    expect(editNarrative(approved, "Revised narrative.").status).toBe("edited");
    expect(unlockNarrative(approved).revisions.at(-1)?.status).toBe("approved");
  });

  it("retains and restores prior revisions without restoring approval", () => {
    const original = approveNarrative(editNarrative(initializeNarratives("2026 Q2", "hash")[0]!, "First text."));
    const revised = editNarrative(original, "Second text.");
    const restored = restoreNarrativeRevision(revised, revised.revisions[0]!.id);
    expect(restored.text).toBe("First text.");
    expect(restored.status).toBe("edited");
    expect(restored.approvedAt).toBeUndefined();
  });
});
