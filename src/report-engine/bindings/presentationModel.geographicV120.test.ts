import { expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { buildPresentationModel } from "./presentationModel";

it("presents the independent frozen market-wide listing and Top 3 without changing the source", () => {
  const report = structuredClone(q2SampleReport);
  const original = structuredClone(report);
  const property = { ...report.availabilities[0]!, address: "2400 Internationale Pkwy, Woodridge, IL", sizeSf: 265062 };
  report.overallFeaturedAvailability = { status: "selected", source: { kind: "contributor", contributorId: "contributor-1",
    availabilityId: "availability-1", propertyId: "property-1", period: "2026 Q2", submarket: "Central DuPage",
    rank: 1, runId: "run-1" }, property, minimumDivisibleSf: 100000,
    marketedMaximumSf: 265062, marketingType: "For Lease", listingUrl: "https://example.com/listing" };
  const expected = structuredClone(report);
  const model = buildPresentationModel(report);
  expect(model.overallGeographic.featuredCardV120).toMatchObject({ area: "100,000–265,062 SF",
    address: "2400 Internationale Pkwy", badge: "VIEW LISTING ↗", listingUrl: "https://example.com/listing" });
  expect(model.overallGeographic.activityIndex).toHaveLength(5);
  expect(model.overallGeographic.activityIndex.every(section => section.entries.length <= 3)).toBe(true);
  expect(report).toEqual(expected);
  expect(original.overallFeaturedAvailability).toBeUndefined();
});
