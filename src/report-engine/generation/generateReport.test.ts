import { describe, expect, it, vi } from "vitest";
import { sampleTemplate } from "../../data/sampleTemplate";
import { generateReportInstance } from "./generateReport";

describe("generateReportInstance", () => {
  it("creates an editable, versioned report snapshot through the provider pipeline", async () => {
    const progress = vi.fn();
    const report = await generateReportInstance(
      sampleTemplate,
      {
        templateId: sampleTemplate.id,
        market: "Chicago",
        period: "2026 Q2",
        source: { provider: "sample" },
      },
      progress,
    );

    expect(report.templateVersion).toBe("1.1.0");
    expect(report.pages).toHaveLength(4);
    expect(report.dataSnapshot.submarkets).toHaveLength(18);
    expect(report.status).toBe("draft");
    expect(progress).toHaveBeenLastCalledWith({
      stage: "complete",
      message: "Report ready to edit",
    });
  });
});
