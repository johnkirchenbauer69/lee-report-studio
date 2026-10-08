import contractArtifact from "../../../contracts/report-studio-narrative-contract-v2.json";
import contractV3Draft from "../../../contracts/report-studio-narrative-contract-v3.draft.json";
import { describe, expect, it } from "vitest";
import {
  REPORT_STUDIO_NARRATIVE_CONTRACT,
  REPORT_STUDIO_NARRATIVE_CONTRACT_V3_DRAFT,
} from "./contract";
import { NARRATIVE_OUTPUT_CONTRACT_VERSION } from "./schema";

describe("Report Studio narrative contract artifact", () => {
  it("matches the canonical runtime contract exactly", () => {
    expect(contractArtifact).toEqual(REPORT_STUDIO_NARRATIVE_CONTRACT);
  });

  it("keeps the transport on narrative-v2 until the coordinated MCP v3 release", () => {
    expect(NARRATIVE_OUTPUT_CONTRACT_VERSION).toBe("narrative-v2");
    expect(REPORT_STUDIO_NARRATIVE_CONTRACT.qualityFlags).not.toContain(
      "transaction_repetition",
    );
  });

  it("keeps the checked-in v3 draft in sync with the local source of truth", () => {
    expect(contractV3Draft).toEqual(REPORT_STUDIO_NARRATIVE_CONTRACT_V3_DRAFT);
    expect(contractV3Draft.analyticalTypes).toEqual(
      expect.arrayContaining([
        "vacancy_bridge",
        "availability_bridge",
        "absorption_bridge",
        "leasing_conversion",
        "pipeline_change",
        "materiality",
        "market_breadth",
        "market_driver",
      ]),
    );
  });
});
