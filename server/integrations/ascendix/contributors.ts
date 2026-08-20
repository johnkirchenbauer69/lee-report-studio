import type {
  LeaseRecord,
  PropertyHighlight,
  ProvenanceRecord,
  SaleRecord,
} from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { canonicalChicagoSubmarket } from "./salesforceFieldMap.ts";
import { normalizeQuarterBounds } from "./salesforceNormalization.ts";

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

export function contributorSection(
  category: unknown,
): ContributorSection | undefined {
  const candidate = normalized(category);
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
const composedAddress = (record: SalesforceRecord, prefix: string) =>
  ["ascendix__Street__c", "ascendix__City__c", "State__c", "Zip_Code__c"]
    .map((field) => text(record, `${prefix}.${field}`))
    .filter(Boolean)
    .join(", ");
const address = (
  record: SalesforceRecord,
  source: "Lease" | "Sale" | "Availability" | "Property",
) =>
  text(record, "Address__c", "Property_Name__c") ||
  composedAddress(record, `${source}__r.ascendix__Property__r`) ||
  composedAddress(record, "Property__r") ||
  text(record, "Display_Title__c");
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
) => Promise<{ url?: string; warning?: string }>;

const image = async (
  record: SalesforceRecord,
  source: "Lease" | "Sale" | "Availability" | "Property",
  resolveImage?: ImageResolver,
): Promise<{ value: string; warning?: string }> => {
  const raw = text(
    record,
    `${source}__r.ascendix__Property__r.ascendix__PrimaryImage__c`,
    "Property__r.ascendix__PrimaryImage__c",
  );
  if (!raw) return { value: raw };
  if (resolveImage) {
    const resolved = await resolveImage(raw);
    return { value: resolved.url ?? "", warning: resolved.warning };
  }
  if (looksLikeSalesforceId(raw))
    return {
      value: "",
      warning: `Salesforce attachment ${raw} could not be resolved (no image resolver is configured).`,
    };
  return { value: raw };
};

export function rankContributors(
  rows: SalesforceRecord[],
  section: ContributorSection,
  limit = 3,
) {
  return rows
    .filter(
      (row) =>
        contributorSection(row.Contributor_Category__c) === section &&
        row.Active_In_Run__c === true &&
        row.Included_In_Report__c === true,
    )
    .sort((a, b) => {
      const aSort =
        optionalNumeric(a, "Sort_Value__c") ?? numeric(a, "Metric_Value__c");
      const bSort =
        optionalNumeric(b, "Sort_Value__c") ?? numeric(b, "Metric_Value__c");
      return bSort - aSort || numeric(a, "Rank__c") - numeric(b, "Rank__c");
    })
    .slice(0, limit);
}

export const looksLikeSalesforceId = (value?: string) =>
  Boolean(value && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value.trim()));

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
  ].flatMap((section) => rankContributors(rows, section as ContributorSection));
  return [...new Map(selected.map((row) => [row.Id, row])).values()];
}

const highlight = async (
  record: SalesforceRecord,
  section: "availabilities" | "deliveries" | "construction",
  resolveImage?: ImageResolver,
): Promise<{ highlight: PropertyHighlight; warning?: string }> => {
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
      ? text(
          record,
          "Property_Type__c",
          "Building_Class__c",
          "Availability__r.ascendix__UseSubType__c",
          "Property__r.ascendix__PropertySubType__c",
        )
      : text(
          record,
          "Property_Type__c",
          "Building_Status__c",
          "Property__r.ascendix__ExpansionType__c",
          "Property__r.ascendix__PropertySubType__c",
        );
  const resolvedImage = await image(record, source, resolveImage);
  return {
    highlight: {
      address: address(record, source),
      sizeSf: numeric(record, ...sizePaths),
      type,
      sponsor: text(
        record,
        "Property__r.ascendix__Developer__r.Name",
        "Property__r.ascendix__OwnerLandlord__r.Name",
        "Availability__r.Listing_Broker_Company__c",
      ),
      image: resolvedImage.value,
    },
    warning: resolvedImage.warning,
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
  const leasing: LeaseRecord[] = leaseRows.map((record) => ({
    tenant: text(
      record,
      "Tenant_Name__c",
      "Display_Title__c",
      "Lease__r.ascendix__Tenant__r.Name",
    ),
    sizeSf: numeric(
      record,
      "Lease_SF__c",
      "Metric_Value__c",
      "Sort_Value__c",
      "Display_Value__c",
    ),
    address: address(record, "Lease"),
    leaseType: [
      text(record, "Deal_Type__c", "Lease__r.Deal_Type__c"),
      text(
        record,
        "Deal_Sub_Type__c",
        "Source_Status__c",
        "Lease__r.Deal_Sub_Type__c",
      ),
    ]
      .filter(Boolean)
      .join(" / "),
  }));
  const sales: SaleRecord[] = saleRows.map((record) => {
    const preferredBuyer = text(
      record,
      "Buyer_Name__c",
      "Display_Title__c",
      "Sale__r.ascendix__Buyer__r.Normalized_Name__c",
      "Sale__r.ascendix__Buyer__r.Name",
    );
    return {
      buyer: looksLikeSalesforceId(preferredBuyer)
        ? "Buyer not published"
        : preferredBuyer,
      price: numeric(
        record,
        "Sale_Price__c",
        "Metric_Value__c",
        "Sort_Value__c",
        "Display_Value__c",
      ),
      address: address(record, "Sale"),
      saleType: text(
        record,
        "Sale_Type__c",
        "Deal_Type__c",
        "Source_Status__c",
        "Sale__r.Sale_Type__c",
      ),
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
      },
      sources: [
        {
          sourceId: row.Id,
          sourceType: "salesforce",
          value: row.Source_Record_ID__c,
          reference: "Market_Data_Contributor__c",
        },
      ],
      authority: "Historical Market_Data_Contributor__c ranking",
      status: "matched",
    }),
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
    .map((entry) => entry.warning)
    .filter((warning): warning is string => Boolean(warning));
  return {
    leasing,
    sales,
    availabilities: availabilityHighlights.map((entry) => entry.highlight),
    deliveries: deliveryHighlights.map((entry) => entry.highlight),
    construction: constructionHighlights.map((entry) => entry.highlight),
    provenance,
    imageWarnings,
  };
}
