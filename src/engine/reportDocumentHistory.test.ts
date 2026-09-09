import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../data/sampleTemplate";
import {
  captureEditorHistory,
  upsertManualOverride,
} from "./reportDocumentHistory";

describe("report document history", () => {
  it("coalesces repeated edits to one override and removes a reverted override", () => {
    const first = upsertManualOverride(
      [],
      {
        elementId: "bound-text",
        bindingPath: "market.narrative",
        generatedValue: "Generated",
        overrideValue: "First edit",
      },
      "2026-09-08T10:00:00.000Z",
    );
    const second = upsertManualOverride(
      first,
      {
        elementId: "bound-text",
        bindingPath: "market.narrative",
        generatedValue: "Generated",
        overrideValue: "Final edit",
      },
      "2026-09-08T11:00:00.000Z",
    );

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      overrideValue: "Final edit",
      createdAt: "2026-09-08T10:00:00.000Z",
    });
    expect(
      upsertManualOverride(second, {
        elementId: "bound-text",
        bindingPath: "market.narrative",
        generatedValue: "Generated",
        overrideValue: "Generated",
      }),
    ).toEqual([]);
  });

  it("captures page and manual-override state together for undo and redo", () => {
    const template = structuredClone(sampleTemplate);
    const snapshot = captureEditorHistory(template, [
      {
        elementId: "bound-text",
        bindingPath: "market.name",
        generatedValue: "Central DuPage",
        overrideValue: "Central DuPage / I-88",
        createdAt: "2026-09-08T10:00:00.000Z",
      },
    ]);
    template.pages[0]!.name = "Changed after capture";

    expect(snapshot.template.pages[0]!.name).not.toBe("Changed after capture");
    expect(snapshot.manualOverrides[0]!.overrideValue).toBe(
      "Central DuPage / I-88",
    );
  });
});
