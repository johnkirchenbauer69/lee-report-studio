import { describe, expect, it } from "vitest";
import { featuredAreaLabel, featuredCardV120, marketingTypeFromRecordType, verifiedListingUrl } from "./featuredCardV120";

describe("Geographic v1.2 featured card", () => {
  it.each([
    [100000, 265062, "100,000–265,062 SF"],
    [0, 265062, "265,062 SF"],
    [265062, 265062, "265,062 SF"],
    [300000, 265062, "265,062 SF"],
    [Number.NaN, 265062, "265,062 SF"],
  ])("handles minimum %s against maximum %s", (minimumDivisibleSf, marketedMaximumSf, expected) => {
    expect(featuredAreaLabel({ availableSf: 265062, minimumDivisibleSf, marketedMaximumSf })).toBe(expected);
  });

  it("does not inflate an Availability with a conflicting maximum", () => {
    expect(featuredAreaLabel({ availableSf: 265062, minimumDivisibleSf: 100000, marketedMaximumSf: 500000 }))
      .toBe("100,000–265,062 SF");
  });

  it.each([["Lease", "For Lease"], ["Sale", "For Sale"], ["Sale or Lease", "For Sale & Lease"]])
  ("uses the Availability record type %s", (value, expected) => {
    expect(marketingTypeFromRecordType(value)).toBe(expected);
  });

  it("does not interpret Direct or Sublet as a marketing type", () => {
    expect(marketingTypeFromRecordType("Direct")).toBeUndefined();
    expect(marketingTypeFromRecordType("Sublet")).toBeUndefined();
  });

  it("keeps the badge noninteractive without a verified URL", () => {
    expect(featuredCardV120({ availableSf: 20000, address: "2400 Internationale Pkwy, Woodridge, IL" }))
      .toMatchObject({ badge: "AVAILABLE", listingUrl: undefined, address: "2400 Internationale Pkwy" });
    expect(verifiedListingUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("shares one verified URL between badge and photograph bindings", () => {
    expect(featuredCardV120({ availableSf: 20000, listingUrl: "https://example.com/property" }))
      .toMatchObject({ badge: "VIEW LISTING ↗", listingUrl: "https://example.com/property" });
  });
});
