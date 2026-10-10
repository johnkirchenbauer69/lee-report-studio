import type {
  AbsorptionContributor,
  DisplayPartySource,
  LeaseRecord,
  PropertyHighlight,
  ProvenanceRecord,
  SaleRecord,
} from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { canonicalChicagoSubmarket } from "./salesforceFieldMap.ts";
import { normalizeQuarterBounds } from "./salesforceNormalization.ts";
import {
  looksLikeSalesforceId,
  sanitizeSalesforceDisplayValue,
} from "../salesforce/salesforceIds.ts";

export type ContributorSection =
  | "availabilities"
  | "featuredListings"
  | "deliveries"
  | "construction"
  | "leasing"
  | "sales"
  | "highestVacancy"
  | "positiveAbsorption"
  | "negativeAbsorption";
const categories: Record<ContributorSection, readonly string[]> = {
  availabilities: ["Largest Availability", "Top Availability", "Availability"],
  featuredListings: [
    "Featured Lee Availability",
    "Featured Listing",
    "Featured Listings",
    "Featured Availability",
    "Featured Lee Listing",
    "Lee Featured Listing",
  ],
  deliveries: ["Largest Delivery", "Top Delivery", "Delivery"],
  construction: [
    "Largest Under Construction",
    "Top Under Construction",
    "Under Construction",
    "Largest UC",
  ],
  leasing: [
    "Largest New Lease",
    "Largest Renewal Lease",
    "Largest Lease",
    "Top Lease",
    "Lease",
  ],
  sales: ["Largest Sale", "Largest Sales", "Top Sale", "Sale"],
  highestVacancy: ["Highest Vacancy"],
  positiveAbsorption: ["Largest Positive Net Absorption"],
  negativeAbsorption: ["Largest Negative Net Absorption"],
};
const normalized = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase();

/**
 * Market Data Engine market-explanation-v1 categories. They are additive
 * explanatory rows, never Top Lease/Sale/Availability/Delivery/Construction
 * highlights, so they must never reach the legacy token fallback below
 * (which would otherwise read "Availability Increase Driver" as an
 * availability highlight and "Pipeline Delivery Driver" as a delivery).
 */
export const MARKET_EXPLANATION_CATEGORIES = [
  "Vacancy Increase Driver",
  "Vacancy Reduction Driver",
  "Availability Increase Driver",
  "Availability Reduction Driver",
  "Pipeline Start Driver",
  "Pipeline Delivery Driver",
] as const;
const explanationCategories = new Set(
  MARKET_EXPLANATION_CATEGORIES.map((name) => name.toLocaleLowerCase()),
);
export const isMarketExplanationCategory = (category: unknown) =>
  explanationCategories.has(normalized(category));

export function contributorSection(
  category: unknown,
): ContributorSection | undefined {
  const candidate = normalized(category);
  if (explanationCategories.has(candidate)) return undefined;
  for (const [section, names] of Object.entries(categories) as [
    ContributorSection,
    readonly string[],
  ][]) {
    if (names.some((name) => normalized(name) === candidate)) return section;
  }
  // Explicit legacy fallback: tolerate punctuation/pluralization while retaining a known semantic token.
  const tokens = candidate
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  if (tokens.includes("lease")) return "leasing";
  if (tokens.includes("sale")) return "sales";
  if (tokens.includes("delivery")) return "deliveries";
  if (tokens.includes("construction") || tokens.includes("uc"))
    return "construction";
  if (
    tokens.includes("featured") &&
    (tokens.includes("listing") || tokens.includes("availability"))
  )
    return "featuredListings";
  if (tokens.includes("availability")) return "availabilities";
  return undefined;
}

export function getSalesforceValue(
  record: SalesforceRecord,
  path: string,
): unknown {
  if (path in record) return record[path];
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      record,
    );
}
const first = (record: SalesforceRecord, ...paths: string[]) =>
  paths
    .map((path) => getSalesforceValue(record, path))
    .find(
      (value) =>
        value !== null && value !== undefined && String(value).trim() !== "",
    );
const text = (record: SalesforceRecord, ...paths: string[]) =>
  String(first(record, ...paths) ?? "").trim();
const displayText = (record: SalesforceRecord, ...paths: string[]) =>
  paths
    .map((path) =>
      sanitizeSalesforceDisplayValue(getSalesforceValue(record, path)),
    )
    .find(Boolean) ?? "";
const numeric = (record: SalesforceRecord, ...paths: string[]) => {
  const raw = first(record, ...paths);
  if (raw === undefined) return 0;
  const parsed =
    typeof raw === "string"
      ? Number(raw.replace(/[^0-9.-]/g, ""))
      : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};
const optionalNumeric = (record: SalesforceRecord, path: string) => {
  const raw = first(record, path);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const optionalNumericPaths = (record: SalesforceRecord, ...paths: string[]) => {
  const raw = first(record, ...paths);
  if (raw === undefined) return undefined;
  const parsed =
    typeof raw === "string"
      ? Number(raw.replace(/[^0-9.-]/g, ""))
      : Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const booleanValue = (record: SalesforceRecord, path: string) => {
  const value = getSalesforceValue(record, path);
  return value === true ? true : value === false ? false : null;
};
const composedAddress = (record: SalesforceRecord, prefix: string) =>
  ["ascendix__Street__c", "ascendix__City__c", "State__c", "Zip_Code__c"]
    .map((field) => displayText(record, `${prefix}.${field}`))
    .filter(Boolean)
    .join(", ");
const address = (
  record: SalesforceRecord,
  source: "Lease" | "Sale" | "Availability" | "Property",
) =>
  displayText(record, "Address__c", "Property_Name__c") ||
  composedAddress(record, `${source}__r.ascendix__Property__r`) ||
  composedAddress(record, "Property__r") ||
  displayText(record, "Display_Title__c");
/**
 * Resolves a contributor/property image field to a usable URL. Delegates to
 * a caller-supplied `resolveImage` (server-side, authenticated Salesforce
 * fetch -> Studio asset) when provided. If a resolver isn't wired up, this
 * still refuses to emit a bare Salesforce Attachment/File id as a URL --
 * such values come back empty with a warning instead of becoming a broken
 * `<img>` request.
 */
export type ImageResolver = (
  value: string | undefined,
) => Promise<{ url?: string; warning?: string; diagnostic?: string }>;

const image = async (
  record: SalesforceRecord,
  source: "Lease" | "Sale" | "Availability" | "Property",
  resolveImage?: ImageResolver,
): Promise<{ value: string; warning?: string; diagnostic?: string }> => {
  const raw = text(
    record,
    `${source}__r.ascendix__Property__r.ascendix__PrimaryImage__c`,
    "Property__r.ascendix__PrimaryImage__c",
  );
  if (!raw) return { value: raw };
  if (resolveImage) {
    const resolved = await resolveImage(raw);
    return {
      value: resolved.url ?? "",
      warning: resolved.warning,
      diagnostic: resolved.diagnostic,
    };
  }
  if (looksLikeSalesforceId(raw))
    return {
      value: "",
      warning: `Salesforce attachment ${raw} could not be resolved (no image resolver is configured).`,
    };
  return { value: raw };
};

/** Canonical Sold / Building SF for a Sale contributor row (enriched Sale first). */
export const saleSoldSf = (row: SalesforceRecord) =>
  optionalNumericPaths(row, "Sale__r.Building_SF__c", "Building_SF__c");
/** Canonical published Sale Price for a Sale contributor row. */
export const salePublishedPrice = (row: SalesforceRecord) =>
  optionalNumericPaths(
    row,
    "Sale_Price__c",
    "Sale__r.ascendix__SalePrice__c",
    "Metric_Value__c",
  );
const saleIdentity = (row: SalesforceRecord) =>
  String(row.Sale__c ?? row.Source_Record_ID__c ?? row.Id ?? "");

/**
 * Top Sales order: Sold / Building SF descending, then Sale Price
 * descending, then the stable Salesforce Sale identity. Rows whose size is
 * unknown sort after every row with a known size. This SELECTS from the
 * whole eligible Sale population handed in (it is applied before the limit),
 * so it never just re-sorts an already price-selected top three.
 */
export function compareSalesBySize(a: SalesforceRecord, b: SalesforceRecord) {
  const aSize = saleSoldSf(a) ?? Number.NEGATIVE_INFINITY;
  const bSize = saleSoldSf(b) ?? Number.NEGATIVE_INFINITY;
  if (aSize !== bSize) return bSize > aSize ? 1 : -1;
  const aPrice = salePublishedPrice(a) ?? Number.NEGATIVE_INFINITY;
  const bPrice = salePublishedPrice(b) ?? Number.NEGATIVE_INFINITY;
  if (aPrice !== bPrice) return bPrice > aPrice ? 1 : -1;
  return saleIdentity(a).localeCompare(saleIdentity(b));
}

/**
 * Upstream contract check: the Market Data Engine documents how it ranked
 * the "Largest Sale" rows it published (Rank_Basis__c). When that basis is
 * price-first, the published rows are a price-ranked top N per submarket, so
 * a larger-by-SF sale outside that set is not available to Report Studio.
 */
export function saleRankBasisMismatch(rows: SalesforceRecord[]) {
  const bases = [
    ...new Set(
      rows
        .filter((row) => contributorSection(row.Contributor_Category__c) === "sales")
        .map((row) => String(row.Rank_Basis__c ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const priceFirst = bases.filter((basis) => /^sale\s*price/i.test(basis));
  return priceFirst.length
    ? `Top Sales upstream contract mismatch: Market_Data_Contributor__c "Largest Sale" rows are ranked by "${priceFirst.join("; ")}" and only the top rows per submarket are published. Report Studio selects Top Sales by Sold SF from that published population, so a larger-by-SF sale outside the Market Data Engine's price-ranked set cannot appear until the engine publishes a Sold-SF-ranked Sale contributor population.`
    : undefined;
}

export function rankContributors(
  rows: SalesforceRecord[],
  section: ContributorSection,
  limit = 3,
) {
  // Prefer the generic population separately for each period/submarket/run.
  // Versioned analytical rows also mark a new run whose generic list is empty;
  // never backfill that deliberate publication exclusion with legacy categories.
  const scopeKey = (row: SalesforceRecord) =>
    [row.Period_End__c ?? row.Quarter_Label__c, row.Submarket__c, row.Run_ID__c]
      .map((value) => String(value ?? "")).join("::");
  const isGeneric = (row: SalesforceRecord) =>
    ["largest lease", "top lease"].includes(normalized(row.Contributor_Category__c));
  const genericScopes = new Set(rows.filter((row) =>
    row.Active_In_Run__c === true && (
      isGeneric(row) || String(row.Calculation_Version__c ?? "").startsWith("mde-lease-reporting-")
    )).map(scopeKey));
  const seen = new Set<string>();
  return rows
    .filter((row) => section !== "leasing" || !genericScopes.has(scopeKey(row)) || (
      isGeneric(row) && row.Narrative_Eligible__c === true &&
      row.Is_Deal_Confidential__c === false
    ))
    .filter(
      (row) =>
        contributorSection(row.Contributor_Category__c) === section &&
        row.Active_In_Run__c === true &&
        row.Included_In_Report__c === true,
    )
    .sort((a, b) => {
      if (section === "sales") return compareSalesBySize(a, b);
      const aSort =
        optionalNumeric(a, "Sort_Value__c") ?? numeric(a, "Metric_Value__c");
      const bSort =
        optionalNumeric(b, "Sort_Value__c") ?? numeric(b, "Metric_Value__c");
      return bSort - aSort || numeric(a, "Rank__c") - numeric(b, "Rank__c") ||
        (section === "leasing"
          ? String(a.Source_Record_ID__c ?? a.Id).localeCompare(String(b.Source_Record_ID__c ?? b.Id))
          : 0);
    })
    .filter((row) => {
      if (section === "sales") {
        // One transaction appears once, even if published in several scopes.
        const identity = `sale::${saleIdentity(row)}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      }
      if (section !== "leasing") return true;
      const identity = `${scopeKey(row)}::${row.Lease__c ?? row.Source_Record_ID__c ?? row.Id}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, limit);
}

export { looksLikeSalesforceId } from "../salesforce/salesforceIds.ts";

export function scopeHistoricalContributors(
  rows: SalesforceRecord[],
  options: {
    period: string;
    submarkets: readonly string[];
    marketDataIds?: ReadonlyMap<string, string>;
  },
) {
  const period = normalizeQuarterBounds(options.period).label;
  const allowed = new Set(
    options.submarkets.map((name) => name.trim().toLocaleLowerCase()),
  );
  const issues: { contributorId: string; reason: string }[] = [];
  const scoped = rows.filter((row) => {
    if (row.Active_In_Run__c !== true || row.Included_In_Report__c !== true)
      return false;
    const rowPeriod = text(row, "Quarter_Label__c");
    const parentPeriod = text(row, "Market_Data__r.Quarter_Label__c");
    const rowSubmarket = text(row, "Submarket__c");
    const parentSubmarket = text(row, "Market_Data__r.Submarket__c");
    const canonical = canonicalChicagoSubmarket(rowSubmarket);
    if (!canonical || !allowed.has(canonical.toLocaleLowerCase())) return false;
    if (normalizeQuarterBounds(rowPeriod).label !== period) return false;
    if (parentPeriod && normalizeQuarterBounds(parentPeriod).label !== period) {
      issues.push({
        contributorId: row.Id,
        reason: `Parent quarter ${parentPeriod} does not match ${period}.`,
      });
      return false;
    }
    if (
      parentSubmarket &&
      parentSubmarket.trim().toLocaleLowerCase() !==
        canonical.toLocaleLowerCase()
    ) {
      issues.push({
        contributorId: row.Id,
        reason: `Contributor submarket ${canonical} conflicts with parent ${parentSubmarket}.`,
      });
      return false;
    }
    const expectedParent = options.marketDataIds?.get(canonical);
    const actualParent = text(row, "Market_Data__c");
    if (expectedParent && actualParent && expectedParent !== actualParent) {
      issues.push({
        contributorId: row.Id,
        reason: `Contributor Market_Data__c ${actualParent} does not match ${expectedParent}.`,
      });
      return false;
    }
    return true;
  });
  return { rows: scoped, issues };
}

export function selectContributorFinalists(rows: SalesforceRecord[]) {
  const selected = [
    "leasing",
    "sales",
    "availabilities",
    "deliveries",
    "construction",
    "positiveAbsorption",
    "negativeAbsorption",
  ].flatMap((section) => rankContributors(rows, section as ContributorSection));
  return [...new Map(selected.map((row) => [row.Id, row])).values()];
}

const BTS_OR_EXPANSION_TYPES = new Set(["built-to-suit", "expansion"]);

/**
 * Governed display-party resolution for a Delivered/Under Construction
 * property card. Built-to-Suit and Expansion properties lead with the
 * occupying tenant (falling back to owner, then developer); every other
 * development type keeps the existing developer-first attribution. This is
 * a pure function so the resolution order itself is directly unit-testable
 * independent of Salesforce field plumbing.
 */
export function resolveDisplayParty(input: {
  developmentTypeRaw?: string;
  tenantName?: string;
  ownerName?: string;
  developerName?: string;
}): {
  displayParty: string | null;
  displayPartySource: DisplayPartySource | null;
} {
  const isBtsOrExpansion = BTS_OR_EXPANSION_TYPES.has(
    normalized(input.developmentTypeRaw ?? ""),
  );
  const tenant = (input.tenantName ?? "").trim();
  const owner = (input.ownerName ?? "").trim();
  const developer = (input.developerName ?? "").trim();
  if (isBtsOrExpansion) {
    if (tenant) return { displayParty: tenant, displayPartySource: "tenant" };
    if (owner) return { displayParty: owner, displayPartySource: "owner" };
    if (developer)
      return { displayParty: developer, displayPartySource: "developer" };
    return { displayParty: null, displayPartySource: null };
  }
  if (developer)
    return { displayParty: developer, displayPartySource: "developer" };
  if (owner) return { displayParty: owner, displayPartySource: "owner" };
  return { displayParty: null, displayPartySource: null };
}

/**
 * Deterministically selects the Lease record that best represents a
 * Built-to-Suit/Expansion property's occupant, when more than one Lease is
 * related to the property. Priority: a new/direct transaction over a
 * renewal, then the most recent lease, then the largest, then the lowest
 * record Id as a final, fully deterministic tiebreaker -- never an
 * arbitrary "first result".
 */
export function selectDisplayLease(
  leases: SalesforceRecord[],
): SalesforceRecord | undefined {
  if (!leases.length) return undefined;
  const scored = leases.map((lease) => {
    const dealType = normalized(text(lease, "Deal_Type__c"));
    const isDirect = /\b(new|direct)\b/.test(dealType);
    const parsedDate = Date.parse(text(lease, "Off_Market_Date__c"));
    const size = numeric(lease, "ascendix__Size__c");
    return { lease, isDirect, parsedDate, size };
  });
  scored.sort((a, b) => {
    if (a.isDirect !== b.isDirect) return a.isDirect ? -1 : 1;
    const aDate = Number.isFinite(a.parsedDate) ? a.parsedDate : -Infinity;
    const bDate = Number.isFinite(b.parsedDate) ? b.parsedDate : -Infinity;
    if (aDate !== bDate) return bDate - aDate;
    if (a.size !== b.size) return b.size - a.size;
    return String(a.lease.Id).localeCompare(String(b.lease.Id));
  });
  return scored[0]!.lease;
}

/**
 * A confidential lease's tenant name is never surfaced on a public report --
 * the display-party resolver treats that the same as "no tenant found" and
 * falls back to owner/developer, rather than leaking a confidential name.
 */
function tenantNameFromLease(lease: SalesforceRecord | undefined): string {
  if (!lease) return "";
  if (booleanValue(lease, "Is_Deal_Confidential__c") === true) return "";
  return displayText(lease, "ascendix__Tenant__r.Name");
}

const highlight = async (
  record: SalesforceRecord,
  section: "availabilities" | "deliveries" | "construction",
  resolveImage?: ImageResolver,
): Promise<{
  highlight: PropertyHighlight;
  warning?: string;
  diagnostic?: string;
}> => {
  const source = section === "availabilities" ? "Availability" : "Property";
  const sizePaths =
    section === "availabilities"
      ? [
          "Available_SF__c",
          "Metric_Value__c",
          "Sort_Value__c",
          "Display_Value__c",
        ]
      : section === "deliveries"
        ? [
            "Delivered_SF__c",
            "Building_SF__c",
            "Metric_Value__c",
            "Sort_Value__c",
          ]
        : [
            "Under_Construction_SF__c",
            "Building_SF__c",
            "Metric_Value__c",
            "Sort_Value__c",
          ];
  const type =
    section === "availabilities"
      ? displayText(
          record,
          "Property_Type__c",
          "Building_Class__c",
          "Availability__r.ascendix__UseSubType__c",
          "Property__r.ascendix__PropertySubType__c",
        )
      : displayText(
          record,
          "Property_Type__c",
          "Building_Status__c",
          "Property__r.ascendix__ExpansionType__c",
          "Property__r.ascendix__PropertySubType__c",
        );
  const resolvedImage = await image(record, source, resolveImage);
  const developmentTypeRaw = displayText(
    record,
    "Property__r.ascendix__ExpansionType__c",
  );
  const ownerName = displayText(
    record,
    "Property__r.ascendix__OwnerLandlord__r.Name",
  );
  const developerName = displayText(
    record,
    "Property__r.ascendix__Developer__r.Name",
  );
  // Tenant attribution only applies to Delivered/Under Construction cards --
  // Top Availabilities keeps its existing listing-driven presentation.
  const isCardSection = section === "deliveries" || section === "construction";
  const relatedLease = isCardSection
    ? (record.Display_Lease__r as SalesforceRecord | undefined)
    : undefined;
  const tenantName = tenantNameFromLease(relatedLease);
  const { displayParty, displayPartySource } = isCardSection
    ? resolveDisplayParty({
        developmentTypeRaw,
        tenantName,
        ownerName,
        developerName,
      })
    : { displayParty: null, displayPartySource: null };
  return {
    highlight: {
      address: address(record, source),
      sizeSf: numeric(record, ...sizePaths),
      type,
      propertyType:
        section === "availabilities"
          ? displayText(
              record,
              "Property_Type__c",
              "Building_Class__c",
              "Property__r.ascendix__PropertySubType__c",
            )
          : undefined,
      availabilityType:
        section === "availabilities"
          ? displayText(
              record,
              "Availability__r.Vacancy_Type__c",
              "Vacancy_Type__c",
              "Availability__r.ascendix__UseSubType__c",
            )
          : undefined,
      developmentType:
        section === "deliveries"
          ? displayText(
              record,
              "Property__r.ascendix__ExpansionType__c",
              "Building_Status__c",
            )
          : undefined,
      constructionType:
        section === "construction"
          ? displayText(
              record,
              "Property__r.ascendix__ExpansionType__c",
              "Building_Status__c",
            )
          : undefined,
      sponsor: displayText(
        record,
        "Property__r.ascendix__Developer__r.Name",
        "Property__r.ascendix__OwnerLandlord__r.Name",
        "Availability__r.Listing_Broker_Company__c",
        "Sponsor_Account__r.Name",
      ),
      developer: displayText(
        record,
        "Property__r.ascendix__Developer__r.Name",
        "Property__r.ascendix__OwnerLandlord__r.Name",
      ),
      developmentTypeRaw: isCardSection ? developmentTypeRaw || undefined : undefined,
      tenantName: isCardSection ? tenantName || undefined : undefined,
      ownerName: isCardSection ? ownerName || undefined : undefined,
      developerName: isCardSection ? developerName || undefined : undefined,
      displayParty: isCardSection ? displayParty : undefined,
      displayPartySource: isCardSection ? displayPartySource : undefined,
      relatedLeaseId: relatedLease?.Id ? String(relatedLease.Id) : undefined,
      displayPartyMatchMethod: !isCardSection
        ? undefined
        : relatedLease
          ? "property-lookup"
          : BTS_OR_EXPANSION_TYPES.has(normalized(developmentTypeRaw))
            ? "none"
            : undefined,
      image: resolvedImage.value,
    },
    warning: resolvedImage.warning,
    diagnostic: resolvedImage.diagnostic,
  };
};

export async function mapHistoricalContributors(
  rows: SalesforceRecord[],
  resolveImage?: ImageResolver,
) {
  const leaseRows = rankContributors(rows, "leasing");
  const saleRows = rankContributors(rows, "sales");
  const availabilityRows = rankContributors(rows, "availabilities");
  const deliveryRows = rankContributors(rows, "deliveries");
  const constructionRows = rankContributors(rows, "construction");
  const positiveAbsorptionRows = rankContributors(
    rows,
    "positiveAbsorption",
    5,
  );
  const negativeAbsorptionRows = rankContributors(
    rows,
    "negativeAbsorption",
    5,
  );
  const leasing: LeaseRecord[] = leaseRows.map((record) => {
    const isDealConfidential = booleanValue(
      record,
      "Lease__r.Is_Deal_Confidential__c",
    );
    const resolvedTenant = displayText(
      record,
      "Tenant_Name__c",
      "Lease__r.ascendix__Tenant__r.Name",
    );
    const tenantDisplayName =
      isDealConfidential === false
        ? resolvedTenant || "Tenant not published"
        : "(Confidential)";
    return {
      tenant: tenantDisplayName,
      tenantDisplayName,
      isDealConfidential,
      isLeeDeal: booleanValue(record, "Lease__r.Lee_Deal__c"),
      sizeSf: numeric(
        record,
        "Lease_SF__c",
        "Metric_Value__c",
        "Sort_Value__c",
        "Display_Value__c",
      ),
      address: address(record, "Lease"),
      leaseType: [
        displayText(record, "Deal_Type__c", "Lease__r.Deal_Type__c"),
        "Deal_Sub_Type__c" in record
          ? displayText(record, "Deal_Sub_Type__c")
          : displayText(record, "Lease__r.Deal_Sub_Type__c"),
      ]
        .filter(Boolean)
        .join(" / "),
    };
  });
  const sales: SaleRecord[] = saleRows.map((record) => {
    const preferredBuyer = displayText(
      record,
      "Sale__r.ascendix__Buyer__r.Normalized_Name__c",
      "Sale__r.ascendix__Buyer__r.Name",
      "Buyer_Name__c",
    );
    const price = numeric(
      record,
      "Sale_Price__c",
      "Metric_Value__c",
      "Sort_Value__c",
      "Display_Value__c",
    );
    // Canonical Sold SF: the enriched Sale relation is authoritative; the
    // contributor row's own denormalized Building_SF__c (the same field
    // deliveries/construction already treat as canonical size) is the
    // fallback when finalist enrichment is unavailable. This is the one
    // Sold SF resolver for sale records -- no second size calculation exists.
    const sizeSf = optionalNumericPaths(
      record,
      "Sale__r.Building_SF__c",
      "Building_SF__c",
    );
    // Canonical Sale Price/SF: prefer the verified Salesforce field. Only
    // when that source value is unavailable, and both a genuinely published
    // price and the canonical Sold SF above are known, derive it here in
    // the data layer (never in the presentation/PDF component). A price
    // that was never published (as opposed to `price` defaulting to 0 for
    // display) must not silently derive a misleading "$0/SF".
    const verifiedPricePerSf = optionalNumericPaths(
      record,
      "Sale__r.ascendix__SalePricePerUOM__c",
    );
    const publishedPrice = optionalNumericPaths(
      record,
      "Sale_Price__c",
      "Metric_Value__c",
      "Sort_Value__c",
      "Display_Value__c",
    );
    const pricePerSf =
      verifiedPricePerSf ??
      (publishedPrice !== undefined && sizeSf && sizeSf > 0
        ? publishedPrice / sizeSf
        : null);
    return {
      buyer: preferredBuyer || "Buyer not published",
      isLeeDeal: booleanValue(record, "Sale__r.Lee_Deal__c"),
      price,
      address: address(record, "Sale"),
      saleType:
        displayText(record, "Sale__r.Sale_Type__c") ||
        "Sale type not published",
      sizeSf,
      pricePerSf,
    };
  });
  const provenanceRows = [
    ...leaseRows.map((row, index) => ["leasing", index, row] as const),
    ...saleRows.map((row, index) => ["sales", index, row] as const),
    ...availabilityRows.map(
      (row, index) => ["availabilities", index, row] as const,
    ),
    ...deliveryRows.map((row, index) => ["deliveries", index, row] as const),
    ...constructionRows.map(
      (row, index) => ["construction", index, row] as const,
    ),
  ];
  const provenance: ProvenanceRecord[] = provenanceRows.map(
    ([section, index, row]) => ({
      fieldPath: `${section}.${index}`,
      selectedValue: {
        contributorId: row.Id,
        marketDataId: row.Market_Data__c,
        quarter: row.Quarter_Label__c,
        submarket: row.Submarket__c,
        category: row.Contributor_Category__c,
        rank: row.Rank__c,
        sortValue: row.Sort_Value__c,
        metricValue: row.Metric_Value__c,
        sourceObject: row.Source_Object__c,
        sourceRecordId: row.Source_Record_ID__c,
        sourceRecordName: row.Source_Record_Name__c,
        propertyId: row.Property__c,
        availabilityId: row.Availability__c,
        leaseId: row.Lease__c,
        saleId: row.Sale__c,
        isDealConfidential:
          section === "leasing"
            ? booleanValue(row, "Lease__r.Is_Deal_Confidential__c")
            : undefined,
        isLeeDeal:
          section === "leasing"
            ? leasing[index]?.isLeeDeal
            : section === "sales"
              ? sales[index]?.isLeeDeal
              : undefined,
        tenantDisplayName:
          section === "leasing" ? leasing[index]?.tenantDisplayName : undefined,
        saleType: section === "sales" ? sales[index]?.saleType : undefined,
      },
      sources: [
        {
          sourceId: row.Id,
          sourceType: "salesforce",
          value: row.Source_Record_ID__c,
          reference: "Market_Data_Contributor__c",
        },
        ...(section === "leasing" && row.Lease__c
          ? [
              {
                sourceId: String(row.Lease__c),
                sourceType: "salesforce" as const,
                value: leasing[index]?.isLeeDeal,
                reference: "ascendix__Lease__c.Lee_Deal__c",
              },
            ]
          : section === "sales" && row.Sale__c
            ? [
                {
                  sourceId: String(row.Sale__c),
                  sourceType: "salesforce" as const,
                  value: sales[index]?.isLeeDeal,
                  reference: "ascendix__Sale__c.Lee_Deal__c",
                },
              ]
            : []),
      ],
      authority: "Historical Market_Data_Contributor__c ranking",
      status: "matched",
    }),
  );
  const absorptionContributors: AbsorptionContributor[] = [
    ...positiveAbsorptionRows.map((record) => ({
      record,
      direction: "positive" as const,
    })),
    ...negativeAbsorptionRows.map((record) => ({
      record,
      direction: "negative" as const,
    })),
  ].map(({ record, direction }) => {
    const raw = numeric(
      record,
      "Metric_Value__c",
      "Sort_Value__c",
      "Display_Value__c",
    );
    const contributionSf =
      direction === "negative" ? -Math.abs(raw) : Math.abs(raw);
    return {
      propertyName:
        displayText(
          record,
          "Source_Record_Name__c",
          "Property__r.Name",
          "Display_Title__c",
        ) || "Property contributor",
      address: address(record, "Property") || undefined,
      contributionSf,
      direction,
      evidenceType: "property_data_net_absorption" as const,
      deterministicallyIdentified: true as const,
    };
  });
  provenance.push(
    ...[...positiveAbsorptionRows, ...negativeAbsorptionRows].map(
      (row, index): ProvenanceRecord => ({
        fieldPath: `absorptionContributors.${index}`,
        selectedValue: {
          category: row.Contributor_Category__c,
          submarket: row.Submarket__c,
          sourceRecordName: row.Source_Record_Name__c,
          metricValue: row.Metric_Value__c,
          sortValue: row.Sort_Value__c,
        },
        sources: [
          {
            sourceId: row.Id,
            sourceType: "salesforce",
            value: row.Source_Record_ID__c,
            reference: "Market_Data_Contributor__c",
          },
        ],
        authority: "Historical Market_Data_Contributor__c absorption ranking",
        status: "matched",
      }),
    ),
  );
  const [availabilityHighlights, deliveryHighlights, constructionHighlights] =
    await Promise.all([
      Promise.all(
        availabilityRows.map((row) =>
          highlight(row, "availabilities", resolveImage),
        ),
      ),
      Promise.all(
        deliveryRows.map((row) => highlight(row, "deliveries", resolveImage)),
      ),
      Promise.all(
        constructionRows.map((row) =>
          highlight(row, "construction", resolveImage),
        ),
      ),
    ]);
  const imageWarnings = [
    ...availabilityHighlights,
    ...deliveryHighlights,
    ...constructionHighlights,
  ]
    .flatMap((entry) => [entry.warning, entry.diagnostic])
    .filter((diagnostic): diagnostic is string => Boolean(diagnostic));
  return {
    leasing,
    sales,
    availabilities: availabilityHighlights.map((entry) => entry.highlight),
    deliveries: deliveryHighlights.map((entry) => entry.highlight),
    construction: constructionHighlights.map((entry) => entry.highlight),
    absorptionContributors,
    provenance,
    imageWarnings,
  };
}
