import type {
  LeaseRecord,
  PropertyHighlight,
  ProvenanceRecord,
  SaleRecord,
} from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";

export type ContributorSection =
  | "availabilities"
  | "featuredListings"
  | "deliveries"
  | "construction"
  | "leasing"
  | "sales";
const categories: Record<ContributorSection, readonly string[]> = {
  availabilities: ["Largest Availability", "Top Availability", "Availability"],
  featuredListings: [
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
  text(record, `${source}__r.ascendix__Property__r.Full_Address__c`) ||
  composedAddress(record, `${source}__r.ascendix__Property__r`) ||
  text(record, "Property__r.Full_Address__c") ||
  composedAddress(record, "Property__r") ||
  text(record, "Address__c", "Property_Name__c", "Display_Title__c");
const image = (
  record: SalesforceRecord,
  source: "Lease" | "Sale" | "Availability" | "Property",
) =>
  text(
    record,
    `${source}__r.ascendix__Property__r.ascendix__PrimaryImage__c`,
    "Property__r.ascendix__PrimaryImage__c",
  );

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

const highlight = (
  record: SalesforceRecord,
  section: "availabilities" | "deliveries" | "construction",
): PropertyHighlight => {
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
          "Availability__r.ascendix__UseSubType__c",
          "Property__r.ascendix__PropertySubType__c",
          "Property_Type__c",
          "Building_Class__c",
        )
      : text(
          record,
          "Property__r.ascendix__ExpansionType__c",
          "Property__r.ascendix__PropertySubType__c",
          "Property_Type__c",
          "Building_Status__c",
        );
  return {
    address: address(record, source),
    sizeSf: numeric(record, ...sizePaths),
    type,
    sponsor: text(
      record,
      "Property__r.ascendix__Developer__r.Name",
      "Property__r.ascendix__OwnerLandlord__r.Name",
      "Availability__r.Listing_Broker_Company__c",
    ),
    image: image(record, source),
  };
};

export function mapHistoricalContributors(rows: SalesforceRecord[]) {
  const leaseRows = rankContributors(rows, "leasing");
  const saleRows = rankContributors(rows, "sales");
  const availabilityRows = rankContributors(rows, "availabilities");
  const deliveryRows = rankContributors(rows, "deliveries");
  const constructionRows = rankContributors(rows, "construction");
  const leasing: LeaseRecord[] = leaseRows.map((record) => ({
    tenant: text(
      record,
      "Lease__r.ascendix__Tenant__r.Name",
      "Tenant_Name__c",
      "Display_Title__c",
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
      text(record, "Lease__r.Deal_Type__c", "Deal_Type__c"),
      text(
        record,
        "Lease__r.Deal_Sub_Type__c",
        "Deal_Sub_Type__c",
        "Source_Status__c",
      ),
    ]
      .filter(Boolean)
      .join(" / "),
  }));
  const sales: SaleRecord[] = saleRows.map((record) => {
    const preferredBuyer = text(
      record,
      "Sale__r.ascendix__Buyer__r.Normalized_Name__c",
      "Sale__r.ascendix__Buyer__r.Name",
      "Buyer_Name__c",
      "Display_Title__c",
    );
    return {
      buyer: /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(preferredBuyer)
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
        "Sale__r.Sale_Type__c",
        "Sale_Type__c",
        "Deal_Type__c",
        "Source_Status__c",
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
        category: row.Contributor_Category__c,
        rank: row.Rank__c,
        sortValue: row.Sort_Value__c,
        sourceObject: row.Source_Object__c,
        sourceRecordId: row.Source_Record_ID__c,
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
  return {
    leasing,
    sales,
    availabilities: availabilityRows.map((row) =>
      highlight(row, "availabilities"),
    ),
    deliveries: deliveryRows.map((row) => highlight(row, "deliveries")),
    construction: constructionRows.map((row) => highlight(row, "construction")),
    provenance,
  };
}
