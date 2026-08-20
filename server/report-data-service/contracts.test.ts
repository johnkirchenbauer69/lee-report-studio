import { describe, expect, it } from "vitest";
import { reportDataRequestSchema } from "./contracts.ts";

describe("report request quarter identity", () => {
  it.each(["2026Q2", "2026 Q2", "Q2 2026"])(
    "canonicalizes %s before consistency validation",
    (period) => {
      const request = reportDataRequestSchema.parse({
        market: "Chicago",
        period,
        calculationScope: { type: "all-submarkets" },
        timeContext: { type: "historical-period", period: "2026 Q2" },
      });
      expect(request.period).toBe("2026 Q2");
      expect(request.timeContext).toEqual({
        type: "historical-period",
        period: "2026 Q2",
      });
    },
  );
});
