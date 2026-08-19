import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { buildPresentationModel } from "./presentationModel";

describe("buildPresentationModel", () => {
  it("uses approved presentation overrides without mutating normalized calculations", () => {
    const model = buildPresentationModel(q2SampleReport);
    const totalRow = model.submarketTableRows.find(
      (row) => row.kind === "total",
    );

    expect(totalRow?.speculative).toBe("34%");
    expect(model.overallMarket.speculativeShare).not.toBe(0.3381477655);
  });
});
