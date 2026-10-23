import { expect, it } from "vitest";
import { featuredCardV121 } from "./featuredCardV121";
import type { IndustrialMarketReport } from "../schema/industrialMarketReport";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
const listing = (marketingType: "For Lease" | "For Sale" | "For Sale & Lease", listingUrl?: string): IndustrialMarketReport["overallFeaturedAvailability"] => ({
  status: "selected", source: { kind: "contributor", contributorId: "qa", availabilityId: "qa", propertyId: "qa", period: "2026 Q3", submarket: "Test", rank: 1, runId: "qa" },
  property: { ...q2SampleReport.availabilities[0]!, address: "12345 North International Industrial Parkway, Woodridge, IL 60517", sizeSf: 999000000, image: "" },
  minimumDivisibleSf: 100000000, marketedMaximumSf: 999000000, marketingType, listingUrl,
});
it.each(["For Lease", "For Sale", "For Sale & Lease"] as const)("keeps %s status separate from the link and city", type => {
  const source = listing(type, "https://example.com/listing");
  const before = structuredClone(source);
  expect(featuredCardV121(source, undefined)).toMatchObject({ status: `AVAILABLE ${type.toUpperCase()}`,
    details: "Woodridge, IL", area: "100,000,000–999,000,000 SF", cta: "VIEW LISTING ↗", listingUrl: "https://example.com/listing" });
  expect(source).toEqual(before);
});
it.each([undefined, "", "javascript:alert(1)"])("omits CTA for unverified URL %s", url => {
  expect(featuredCardV121(listing("For Sale", url), undefined)).toMatchObject({ status: "AVAILABLE FOR SALE", cta: "", listingUrl: undefined });
});
it.each(["lease", "sale"] as const)("labels completed %s without availability text or link", kind => {
  const deal: IndustrialMarketReport["overallFeaturedDeal"] = { status: "selected", kind,
    source: { contributorId: "qa", transactionId: "qa", propertyId: "qa", period: "2026 Q3", submarket: "Test", rank: 1, runId: "qa", selectionBasis: "Verified Lee transaction" },
    property: { address: "100 Main St, Chicago, IL", sizeSf: 25000, image: "" } };
  expect(featuredCardV121(undefined, deal)).toMatchObject({ status: kind === "lease" ? "LEASED" : "SOLD", details: "Chicago, IL", cta: "", listingUrl: undefined });
});
