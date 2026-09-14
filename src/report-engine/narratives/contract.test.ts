import contractArtifact from "../../../contracts/report-studio-narrative-contract-v2.json";
import { describe, expect, it } from "vitest";
import { REPORT_STUDIO_NARRATIVE_CONTRACT } from "./contract";

describe("Report Studio narrative contract artifact", () => {
  it("matches the canonical runtime contract exactly", () => {
    expect(contractArtifact).toEqual(REPORT_STUDIO_NARRATIVE_CONTRACT);
  });
});
