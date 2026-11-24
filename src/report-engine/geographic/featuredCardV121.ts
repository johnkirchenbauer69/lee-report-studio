import { featuredCardV120 } from "./featuredCardV120";
import type { IndustrialMarketReport } from "../schema/industrialMarketReport";

type Listing = IndustrialMarketReport["overallFeaturedAvailability"];
type Deal = IndustrialMarketReport["overallFeaturedDeal"];
type Projects = IndustrialMarketReport["deliveries"];
type Metrics = IndustrialMarketReport["overallMarket"];

function featuredProject(projects: Projects) {
  return projects
    .filter(project => project.image?.trim() && project.address.trim() && project.sizeSf > 0)
    .sort((a, b) => b.sizeSf - a.sizeSf || a.address.localeCompare(b.address))[0];
}

export function featuredCardV121(
  listing: Listing,
  deal: Deal,
  deliveries: Projects = [],
  construction: Projects = [],
  metrics?: Pick<Metrics, "vacancyRate" | "availabilityRate">,
) {
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
  const delivery = featuredProject(deliveries);
  const project = delivery ?? featuredProject(construction);
  if (project) {
    const card = featuredCardV120({ image: project.image, address: project.address, availableSf: project.sizeSf });
    const place = card.details.replace(/(?: · )?Available$/, "");
    return { ...card, details: [place, project.developer || project.sponsor].filter(Boolean).join(" · "),
      status: delivery ? "DELIVERED" : "UNDER CONSTRUCTION", cta: "", ctaText: "", listingUrl: undefined };
  }
  const rate = (value: number) => (value * 100).toFixed(2) + "%";
  return { image: "", area: metrics ? `${rate(metrics.vacancyRate)} vacancy` : "", address: "Quarterly market snapshot",
    details: metrics ? `${rate(metrics.availabilityRate)} availability` : "No qualifying featured activity",
    status: "MARKET SNAPSHOT", cta: "", ctaText: "", listingUrl: undefined };
}
