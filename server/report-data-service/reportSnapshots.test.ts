import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport.ts";
import { hashNormalizedReport } from "./reportSnapshots.ts";

describe("report snapshot hashing", () => {
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
