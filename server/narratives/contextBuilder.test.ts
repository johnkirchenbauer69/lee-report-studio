import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate.ts";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport.ts";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport.ts";
import {
  buildNarrativeContext,
  NARRATIVE_MATERIALITY,
  publicNarrativeContext,
} from "./contextBuilder.ts";

async function fixture() {
  return generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
}

describe("buildNarrativeContext", () => {
  it("builds stable Overall context from all 18 canonical submarkets", async () => {
    const instance = await fixture();
    const first = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const second = buildNarrativeContext({ reportInstance: structuredClone(instance), marketId: "overall-market" });
    expect(instance.dataSnapshot.submarkets).toHaveLength(18);
    expect(first.contextHash).toBe(second.contextHash);
    expect(first.facts.filter((item) => item.category === "ranking")).toHaveLength(24);
    expect(first.facts.some((item) => item.contextKey === "metric.vacancy.qoq_bps")).toBe(true);
    expect(first.facts.find((item) => item.contextKey === "metric.median_sales_price_psf.current")?.value).toBeNull();
  });

  it("scopes submarket context and excludes confidential or unknown leases", async () => {
    const instance = await fixture();
    const central = instance.dataSnapshot.submarketDetails.find((item) => item.name === "Central DuPage")!;
    const ohare = instance.dataSnapshot.submarketDetails.find((item) => item.name === "O'Hare")!;
    central.leasing = [
      { tenant: "Public Tenant", tenantDisplayName: "Public Tenant", isDealConfidential: false, sizeSf: 200_000, address: "100 Public Road", leaseType: "Direct / New" },
      { tenant: "Secret Tenant", tenantDisplayName: "Secret Tenant", isDealConfidential: true, sizeSf: 900_000, address: "200 Secret Road", leaseType: "Direct / New" },
      { tenant: "Unknown Tenant", tenantDisplayName: "Unknown Tenant", isDealConfidential: null, sizeSf: 800_000, address: "300 Unknown Road", leaseType: "Direct / New" },
    ];
    ohare.leasing = [
      { tenant: "Other Market Tenant", tenantDisplayName: "Other Market Tenant", isDealConfidential: false, sizeSf: 700_000, address: "400 Other Road", leaseType: "Renewal" },
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const serialized = JSON.stringify(publicNarrativeContext(context));
    expect(serialized).toContain("Public Tenant");
    expect(serialized).not.toContain("Secret Tenant");
    expect(serialized).not.toContain("Unknown Tenant");
    expect(serialized).not.toContain("Other Market Tenant");
  });

  it("caps material records and strips internal IDs from client context", async () => {
    const instance = await fixture();
    instance.dataSnapshot.leasing = Array.from({ length: 9 }, (_, index) => ({
      tenant:
        index === 0
          ? "Tenant 001A0000009z3ZIAAZ internal"
          : `Tenant ${index}`,
      isDealConfidential: false,
      sizeSf: 100_000 - index,
      address: `${index + 1} Main Street`,
      leaseType: "Direct / New",
    }));
    instance.dataSnapshot.provenance.push({
      fieldPath: "leasing.0",
      selectedValue: "safe",
      sources: [{ sourceId: "001A0000009z3ZI", sourceType: "salesforce", value: "safe", reference: "Lease" }],
      authority: "test",
      status: "matched",
    });
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    expect(context.facts.filter((item) => item.category === "lease")).toHaveLength(NARRATIVE_MATERIALITY.leases);
    expect(context.facts.some((item) => item.internalSourceIds?.includes("001A0000009z3ZI"))).toBe(true);
    const clientContext = JSON.stringify(publicNarrativeContext(context));
    expect(clientContext).not.toContain("001A0000009z3ZI");
    expect(clientContext).not.toContain("001A0000009z3ZIAAZ");
  });
});
