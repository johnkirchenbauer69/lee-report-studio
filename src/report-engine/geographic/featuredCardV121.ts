import { featuredCardV120 } from "./featuredCardV120";
import type { IndustrialMarketReport } from "../schema/industrialMarketReport";

type Listing = IndustrialMarketReport["overallFeaturedAvailability"];
type Deal = IndustrialMarketReport["overallFeaturedDeal"];
export function featuredCardV121(listing: Listing, deal: Deal) {
  if (listing?.status === "selected") {
    const card = featuredCardV120({ ...listing, image: listing.property.image,
      address: listing.property.address, availableSf: listing.property.sizeSf });
    const status = listing.marketingType === "For Lease" ? "AVAILABLE FOR LEASE"
      : listing.marketingType === "For Sale" ? "AVAILABLE FOR SALE"
      : listing.marketingType === "For Sale & Lease" ? "AVAILABLE FOR SALE & LEASE" : "AVAILABLE";
    return { ...card, details: card.details.includes(" · ") ? card.details.split(" · ")[0] : "", status,
      cta: card.listingUrl ? "VIEW LISTING ↗" : "", ctaText: card.listingUrl ? "VIEW LISTING" : "" };
  }
  if (deal?.status === "selected") {
    const card = featuredCardV120({ image: deal.property.image, address: deal.property.address,
      availableSf: deal.property.sizeSf });
    return { ...card, details: card.details.replace(/(?: · )?Available$/, ""),
      status: deal.kind === "lease" ? "LEASED" : "SOLD", cta: "", ctaText: "", listingUrl: undefined };
  }
  return { image: "", area: "", address: "Quarterly market perspective",
    details: "No verified Lee property this quarter", status: "", cta: "", ctaText: "", listingUrl: undefined };
}
