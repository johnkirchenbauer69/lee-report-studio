import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadReportPeriods,
  ReportPeriodDiscoveryError,
} from "./reportPeriodStore";

describe("report period store", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads live period options without adding browser-side fallbacks", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          periods: [
            { label: "2026 Q3", periodEnd: "2026-09-30", submarketCount: 18 },
          ],
          mode: "salesforce",
          requiredSubmarketCount: 18,
          generatedAt: "2026-08-20T12:00:00.000Z",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await loadReportPeriods("/periods", "https://api.test");
    expect(result.periods.map((period) => period.label)).toEqual(["2026 Q3"]);
    expect(fetcher).toHaveBeenCalledWith("https://api.test/periods", {
      headers: { accept: "application/json" },
    });
  });

  it("surfaces Salesforce failure instead of returning stale hard-coded data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(loadReportPeriods()).rejects.toBeInstanceOf(
      ReportPeriodDiscoveryError,
    );
  });
});
