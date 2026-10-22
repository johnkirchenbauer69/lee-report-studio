/** Geographic v1.2 card text is derived only from fields frozen with the selected source. */
export type MarketingType = "For Lease" | "For Sale" | "For Sale & Lease";

export function marketingTypeFromRecordType(value: unknown): MarketingType | undefined {
  switch (String(value ?? "").trim().toLowerCase()) {
    case "lease": return "For Lease";
    case "sale": return "For Sale";
    case "sale or lease":
    case "saleorlease": return "For Sale & Lease";
    default: return undefined;
  }
}

function validSf(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function featuredAreaLabel(input: {
  availableSf: unknown;
  minimumDivisibleSf?: unknown;
  marketedMaximumSf?: unknown;
}): string {
  if (!validSf(input.availableSf)) return "Area not published";
  const available = input.availableSf;
  // The selected Availability's marketed amount is the ceiling. A conflicting
  // maximum contiguous value must never inflate this quarter's availability.
  const maximum = validSf(input.marketedMaximumSf) && input.marketedMaximumSf <= available
    ? input.marketedMaximumSf : available;
  const minimum = input.minimumDivisibleSf;
  const format = (sf: number) => Math.round(sf).toLocaleString("en-US");
  return validSf(minimum) && minimum < maximum
    ? `${format(minimum)}–${format(maximum)} SF`
    : `${format(available)} SF`;
}

export function verifiedListingUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && url.hostname ? url.href : undefined;
  } catch { return undefined; }
}

export function featuredCardV120(input: {
  image?: string;
  address?: string;
  availableSf?: number;
  minimumDivisibleSf?: number;
  marketedMaximumSf?: number;
  marketingType?: MarketingType;
  listingUrl?: string;
}) {
  const addressParts = (input.address ?? "").split(",").map(part => part.trim());
  const street = addressParts[0] || "Property details available on request";
  const place = addressParts.slice(1, 3).join(", ").replace(/\s+\d{5}(?:-\d{4})?$/, "");
  const listingUrl = verifiedListingUrl(input.listingUrl);
  return {
    image: input.image ?? "",
    area: featuredAreaLabel({ availableSf: input.availableSf, minimumDivisibleSf: input.minimumDivisibleSf,
      marketedMaximumSf: input.marketedMaximumSf }),
    address: street,
    details: [place, input.marketingType ?? "Available"].filter(Boolean).join(" · "),
    badge: listingUrl ? "VIEW LISTING ↗" : "AVAILABLE",
    listingUrl,
  };
}
