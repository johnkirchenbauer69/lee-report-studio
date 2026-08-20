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

  it("binds the table and narrative to quarterly absorption and indicators to T12", () => {
    const model = buildPresentationModel(q2SampleReport);
    const totalRow = model.submarketTableRows.find(
      (row) => row.kind === "total",
    );
    const absorptionIndicator = model.indicatorRows.find((row) =>
      row.metric.includes("12 Month Net Absorption"),
    );

    expect(totalRow?.absorption).toBe("5,206,811");
    expect(model.overallMarket.quarterlyNetAbsorptionSf).toBe(5_206_811);
    expect(model.overallMarket.narrative).toContain(
      "Quarterly net absorption totaled 5.21 million square feet",
    );
    expect(absorptionIndicator?.q2).toBe("17,654,829");
  });
});
