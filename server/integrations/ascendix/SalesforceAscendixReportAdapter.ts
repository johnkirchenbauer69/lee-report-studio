import type {
  IndustrialMarketReport,
  MarketMetrics,
  OverallMarketMetrics,
  ProvenanceRecord,
  SubmarketMetrics,
} from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { ReportDataRequest } from "../../report-data-service/contracts.ts";
import type {
  SalesforceClient,
  SalesforceRecord,
} from "../salesforce/SalesforceClient.ts";
import {
  selectQuery,
  soqlLiteral,
  soqlLiteralList,
} from "../salesforce/soql.ts";
import type { AscendixReportAdapter } from "./AscendixReportAdapter.ts";
import {
  contributorSection,
  mapHistoricalContributors,
  saleRankBasisMismatch,
  scopeHistoricalContributors,
  selectContributorFinalists,
  selectDisplayLease,
  type ImageResolver,
} from "./contributors.ts";
import {
  mapExplanatoryContributors,
  overallMarketExplanationRows,
} from "./explanatoryContributors.ts";
import { classifyInventoryReconciliation } from "./inventoryReconciliation.ts";
import { buildInventoryReconciliationDetails } from "./inventoryReconciliationDetails.ts";
import { looksLikeSalesforceId } from "../salesforce/salesforceIds.ts";
import {
  CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS,
  ELIGIBLE_MARKET_UNIVERSE_SCOPE,
  canonicalChicagoSubmarket,
  salesforceFieldMap as mapping,
} from "./salesforceFieldMap.ts";
import { resolveChicagoSubmarket } from "../../../src/report-engine/submarkets.ts";
import {
  normalizeQuarterBounds,
  normalizeSalesforceMarketDataRecord,
} from "./salesforceNormalization.ts";
import {
  aggregateQuarterlyMarketPeriod,
  aggregateAvailabilityBySize,
  calculateTrailing12MonthNetAbsorption,
  mapOverallMarketPeriod,
  OVERALL_MARKET_PERIOD_METRICS,
  rollupPropertyData,
  verifiedSpeculativeShare,
} from "./salesforceRollups.ts";
import {
  reportablePeriodsFromMarketData,
  reportPeriodDiscoveryQuery,
} from "./periodDiscovery.ts";

const api = (entry: { apiName: string } | string) =>
  typeof entry === "string" ? entry : entry.apiName;
const value = (record: SalesforceRecord, entry: { apiName: string }) =>
  record[entry.apiName];
const text = (
  record: SalesforceRecord,
  entry: { apiName: string },
  fallback = "",
) => String(value(record, entry) ?? fallback).trim();
const number = (
  record: SalesforceRecord,
  entry: { apiName: string },
  label: string,
) => {
  const source = value(record, entry);
  if (source === null || source === undefined || source === "")
    throw new Error(`Salesforce returned a missing ${label}.`);
  const found = Number(source);
  if (!Number.isFinite(found))
    throw new Error(`Salesforce returned an invalid ${label}.`);
  return found;
};
const rate = (
  record: SalesforceRecord,
  entry: { apiName: string },
  label: string,
) => {
  const found = number(record, entry, label);
  if (found < 0 || found > 1)
    throw new Error(`Salesforce returned an invalid ${label}.`);
  return found;
};
const unavailableAsZero = (
  record: SalesforceRecord,
  entry: { apiName: string },
  label: string,
) => {
  const source = value(record, entry);
  if (source === null || source === undefined || source === "") return 0;
  return number(record, entry, label);
};
const md = mapping.marketData;
const pd = mapping.propertyData;

/** First-class Chicago Overall Market Market_Data__c identity. */
export const OVERALL_MARKET_GEOGRAPHY_LEVEL = "Overall Market";
export const OVERALL_MARKET_GEOGRAPHY_CODE = "OVERALL_MARKET";
export const OVERALL_MARKET_RECORD = "OVERALL_MARKET_RECORD";
export const SUBMARKET_ROLLUP_FALLBACK = "SUBMARKET_ROLLUP_FALLBACK";
const overallMarketExtraFields = [
  md.geographyLevel,
  md.geographyCode,
  md.inventoryBuildings,
  md.directAvailableSf,
  md.subletAvailableSf,
  md.directAvailableRate,
  md.subletAvailableRate,
  md.directVacantSf,
  md.subletVacantSf,
  md.directVacantRate,
  md.subletVacantRate,
  md.occupancySf,
  md.occupancyRate,
  md.deliveredBuildings,
  md.underConstructionBuildings,
  md.totalSoldBuildings,
  md.totalSoldSf,
  md.averageSalesPrice,
  md.medianSalesPrice,
  md.averageSalesPriceSf,
  md.averageSoldSf,
  md.medianSoldBuildingSizeSf,
  md.averageActualCapRate,
  md.medianActualCapRate,
  md.actualCapRateObservationCount,
  md.directNetRentPsf,
  md.subletNetRentPsf,
];
const metricFields = [
  md.inventorySf,
  md.deliveredSf,
  md.underConstructionSf,
  md.underConstructionAvailableSf,
  md.quarterlyNetAbsorptionSf,
  md.totalVacantSf,
  md.vacancyRate,
  md.totalAvailableSf,
  md.availabilityRate,
  md.askingNetRentPsf,
  md.salesVolume,
  md.salesTransactions,
  md.medianSalesPricePerBuildingSf,
] as const;

function speculativeShare(record: SalesforceRecord) {
  return verifiedSpeculativeShare(
    number(record, md.underConstructionSf, "under construction area"),
    number(
      record,
      md.underConstructionAvailableSf,
      "under construction available area",
    ),
  );
}
function metrics(record: SalesforceRecord): MarketMetrics {
  return {
    inventorySf: number(record, md.inventorySf, "inventory"),
    deliveredSf: number(record, md.deliveredSf, "delivered area"),
    underConstructionSf: number(
      record,
      md.underConstructionSf,
      "under construction area",
    ),
    speculativeShare: speculativeShare(record),
    quarterlyNetAbsorptionSf: number(
      record,
      md.quarterlyNetAbsorptionSf,
      "quarterly net absorption",
    ),
    vacancyRate: rate(record, md.vacancyRate, "vacancy rate"),
    availabilityRate: rate(record, md.availabilityRate, "availability rate"),
    askingNetRentPsf: unavailableAsZero(
      record,
      md.askingNetRentPsf,
      "asking rent",
    ),
    salesVolume: number(record, md.salesVolume, "sales volume"),
  };
}

/**
 * Headline metrics for a first-class Overall Market row. Same mapping as a
 * submarket snapshot, except a null Overall_Net_Rent_SF__c is preserved as an
 * AUTHORITATIVE_NULL instead of becoming $0 (no zero, no fallback).
 */
function overallMarketRowMetrics(record: SalesforceRecord) {
  const source = value(record, md.askingNetRentPsf);
  return {
    ...metrics(record),
    askingNetRentPsf:
      source === null || source === undefined || source === ""
        ? null
        : number(record, md.askingNetRentPsf, "asking rent"),
  };
}

const contributorBaseFields = Object.values(mapping.contributor)
  .filter(
    (field) =>
      field !== mapping.contributor.object &&
      field.verification !== "optional-probed",
  )
  .map(api)
  .filter((field, index, fields) => fields.indexOf(field) === index);
const propertyDataFields = Object.values(mapping.propertyData)
  .filter((field) => field !== mapping.propertyData.object)
  .map(api)
  .filter((field, index, fields) => fields.indexOf(field) === index);
propertyDataFields.push(
  "Property__r.Name",
  "Property__r.ascendix__Street__c",
  "Property__r.ascendix__City__c",
  "Property__r.State__c",
  "Property__r.Submarket_Picklist__c",
  "Property__r.ascendix__BuildingStatus__c",
);

function ids(rows: SalesforceRecord[], field: string) {
  return [
    ...new Set(
      rows.map((row) => String(row[field] ?? "").trim()).filter(Boolean),
    ),
  ];
}

async function enrichFinalists(
  client: SalesforceClient,
  finalists: SalesforceRecord[],
  calls: Record<string, number>,
  diagnostics: string[],
) {
  const sections = new Map(
    finalists.map((row) => [
      row.Id,
      String(row.Contributor_Category__c ?? "").toLocaleLowerCase(),
    ]),
  );
  const propertyRows = finalists.filter(
    (row) =>
      sections.get(row.Id)?.includes("delivery") ||
      sections.get(row.Id)?.includes("construction") ||
      sections.get(row.Id)?.includes("availability"),
  );
  const availabilityRows = finalists.filter((row) =>
    sections.get(row.Id)?.includes("availability"),
  );
  // These relationships carry authoritative client-facing contracts, so every
  // finalist is enriched rather than trusting denormalized contributor labels.
  const leaseRows = finalists.filter((row) =>
    sections.get(row.Id)?.includes("lease"),
  );
  const saleRows = finalists.filter((row) =>
    sections.get(row.Id)?.includes("sale"),
  );
  const jobs: Promise<void>[] = [];
  const run = (
    object: string,
    fields: string[],
    sourceRows: SalesforceRecord[],
    idField: string,
    target: string,
  ) => {
    const sourceIds = ids(sourceRows, idField);
    if (!sourceIds.length) return;
    calls.enrichment += 1;
    jobs.push(
      client
        .query(
          selectQuery(
            object,
            fields,
            `Id IN ${soqlLiteralList(sourceIds, "source IDs")}`,
          ),
        )
        .then((records) => {
          const found = new Map(records.map((record) => [record.Id, record]));
          for (const row of sourceRows) {
            const enrichment = found.get(String(row[idField] ?? ""));
            if (enrichment) row[target] = enrichment;
          }
        })
        .catch(() => {
          diagnostics.push(
            `Optional finalist enrichment unavailable for ${object}; contributor-native values were retained.`,
          );
        }),
    );
  };
  run(
    api(mapping.property.object),
    [
      "Id",
      api(mapping.property.street),
      api(mapping.property.city),
      api(mapping.property.state),
      api(mapping.property.zip),
      api(mapping.property.propertySubtype),
      api(mapping.property.expansionType),
      api(mapping.property.developerName),
      api(mapping.property.ownerName),
      api(mapping.property.image),
    ],
    propertyRows,
    "Property__c",
    "Property__r",
  );
  run(
    api(mapping.availability.object),
    [
      "Id",
      api(mapping.availability.useSubtype),
      api(mapping.availability.vacancyType),
      api(mapping.availability.brokerCompany),
      "ascendix__Property__r.ascendix__PrimaryImage__c",
    ],
    availabilityRows,
    "Availability__c",
    "Availability__r",
  );
  run(
    api(mapping.lease.object),
    [
      "Id",
      api(mapping.lease.tenant),
      api(mapping.lease.type),
      api(mapping.lease.subtype),
      api(mapping.lease.isDealConfidential),
      api(mapping.lease.leeDeal),
    ],
    leaseRows,
    "Lease__c",
    "Lease__r",
  );
  run(
    api(mapping.sale.object),
    [
      "Id",
      api(mapping.sale.normalizedBuyer),
      api(mapping.sale.buyer),
      api(mapping.sale.type),
      api(mapping.sale.leeDeal),
      api(mapping.sale.buildingSf),
      api(mapping.sale.pricePerUom),
    ],
    saleRows,
    "Sale__c",
    "Sale__r",
  );
  await Promise.all(jobs);
  // Built-to-Suit/Expansion tenant attribution: Property -> Lease is a
  // one-to-many relationship with no denormalized tenant field on the
  // contributor row, so this is a deterministic, governed lookup rather
  // than fuzzy matching. Only attempted for Delivered/Under Construction
  // finalists whose enriched Property is actually Built-to-Suit or
  // Expansion -- every other card keeps its existing developer/owner
  // attribution untouched.
  const deliveryConstructionRows = finalists.filter(
    (row) =>
      sections.get(row.Id)?.includes("delivery") ||
      sections.get(row.Id)?.includes("construction"),
  );
  const btsExpansionRows = deliveryConstructionRows.filter((row) => {
    const property = row.Property__r as SalesforceRecord | undefined;
    const raw = String(
      property?.[api(mapping.property.expansionType)] ?? "",
    )
      .trim()
      .toLocaleLowerCase();
    return raw === "built-to-suit" || raw === "expansion";
  });
  const propertyIdsForLease = ids(btsExpansionRows, "Property__c");
  if (propertyIdsForLease.length) {
    calls.enrichment += 1;
    try {
      const leaseRecords = await client.query(
        selectQuery(
          api(mapping.lease.object),
          [
            "Id",
            api(mapping.lease.propertyId),
            api(mapping.lease.tenant),
            api(mapping.lease.isDealConfidential),
            api(mapping.lease.type),
            api(mapping.lease.offMarketDate),
            api(mapping.lease.sizeSf),
          ],
          `${api(mapping.lease.propertyId)} IN ${soqlLiteralList(propertyIdsForLease, "property IDs")}`,
        ),
      );
      const byProperty = new Map<string, SalesforceRecord[]>();
      for (const lease of leaseRecords) {
        const key = String(lease[api(mapping.lease.propertyId)] ?? "");
        if (!key) continue;
        const bucket = byProperty.get(key) ?? [];
        bucket.push(lease);
        byProperty.set(key, bucket);
      }
      for (const row of btsExpansionRows) {
        const chosen = selectDisplayLease(
          byProperty.get(String(row.Property__c ?? "")) ?? [],
        );
        if (chosen) row.Display_Lease__r = chosen;
      }
    } catch {
      diagnostics.push(
        "Optional Built-to-Suit/Expansion tenant lookup unavailable; owner/developer attribution was retained.",
      );
    }
  }
  for (const row of availabilityRows) {
    const relation = row.Availability__r as SalesforceRecord | undefined;
    const candidate = String(
      relation?.Listing_Broker_Company__c ??
        row["Availability__r.Listing_Broker_Company__c"] ??
        "",
    ).trim();
    if (looksLikeSalesforceId(candidate))
      row.Sponsor_Account_Id__local = candidate;
  }
  run(
    "Account",
    ["Id", "Name"],
    availabilityRows,
    "Sponsor_Account_Id__local",
    "Sponsor_Account__r",
  );
  await Promise.all(jobs);
}

export class SalesforceAscendixReportAdapter implements AscendixReportAdapter {
  constructor(
    private readonly client: SalesforceClient,
    private readonly now: () => Date = () => new Date(),
    private readonly resolveImage?: ImageResolver,
  ) {}

  async discoverReportPeriods() {
    return reportablePeriodsFromMarketData(
      await this.client.query(reportPeriodDiscoveryQuery()),
    );
  }

  async loadReportSource(request: ReportDataRequest) {
    if (request.timeContext.type === "current")
      throw new Error(
        "Current Salesforce report mapping is not configured yet; use a historical-period request.",
      );
    const apiCallsBefore = this.client.getApiCallCount?.() ?? 0;
    const bounds = normalizeQuarterBounds(request.period);
    const period = soqlLiteral(bounds.label, "period");
    const accepted = soqlLiteralList(
      CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS,
      "Chicago submarkets",
    );
    const contributorGeographies = soqlLiteralList(
      [...CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS, "Overall Market"],
      "Chicago contributor geographies",
    );
    const explanationDiagnostics: string[] = [];
    const marketFields = [
      md.id,
      md.name,
      md.period,
      md.periodStart,
      md.periodEnd,
      md.periodType,
      md.quarter,
      md.year,
      md.submarket,
      md.submarketCode,
      md.state,
      md.externalId,
      md.asOf,
      md.lastCalculatedAt,
      md.calcVersion,
      md.calcNotes,
      md.dataSource,
      md.dataSourceMethod,
      ...metricFields,
      md.leasingActivitySf,
    ].map(api);
    const currentQuery = selectQuery(
      api(md.object),
      marketFields,
      `${api(md.period)} = ${period} AND ${api(md.submarket)} IN ${accepted}`,
    );
    const historyQuery = selectQuery(
      api(md.object),
      marketFields,
      `${api(md.submarket)} IN ${accepted}`,
      ` ORDER BY ${api(md.period)} DESC LIMIT 216`,
    );
    const propertyDataQuery = selectQuery(
      api(pd.object),
      propertyDataFields,
      `${api(pd.quarter)} = ${period} AND ${api(pd.scope)} = ${soqlLiteral(ELIGIBLE_MARKET_UNIVERSE_SCOPE, "property data scope")} AND ${api(pd.submarket)} IN ${accepted}`,
    );
    // Dedicated, logically separate Overall Market population. These rows are
    // never mixed into the submarket collection or re-aggregated.
    const overallMarketQuery = selectQuery(
      api(md.object),
      [...marketFields, ...overallMarketExtraFields.map(api)].filter(
        (field, index, fields) => fields.indexOf(field) === index,
      ),
      `${api(md.geographyLevel)} = ${soqlLiteral(OVERALL_MARKET_GEOGRAPHY_LEVEL, "geography level")} AND ${api(md.geographyCode)} = ${soqlLiteral(OVERALL_MARKET_GEOGRAPHY_CODE, "geography code")}`,
      ` ORDER BY ${api(md.periodEnd)} DESC LIMIT 200`,
    );
    const contributor = mapping.contributor;
    const contributorQuery = selectQuery(
      api(contributor.object),
      contributorBaseFields,
      // "Overall Market" is included so market-explanation-v1 Overall Market
      // rows can be read. Canonical submarket scoping still excludes them
      // from every existing Contributor section.
      `${api(contributor.period)} = ${period} AND ${api(contributor.submarket)} IN ${contributorGeographies} AND ${api(contributor.active)} = TRUE AND ${api(contributor.included)} = TRUE`,
    );
    const calls = {
      marketData: 3,
      contributor: 1,
      propertyData: 1,
      enrichment: 0,
      capability: 0,
    };
    const [currentRaw, historyRaw, propertyRows, contributorRows, overallRaw] =
      await Promise.all([
        this.client.query(currentQuery),
        this.client.query(historyQuery),
        this.client.query(propertyDataQuery),
        this.client.query(contributorQuery),
        this.client.query(overallMarketQuery),
      ]);
    const current = currentRaw.map(normalizeSalesforceMarketDataRecord);
    const history = historyRaw.map(normalizeSalesforceMarketDataRecord);
    const overallMarketDiagnostics: string[] = [];
    const overallByQuarter = new Map<string, SalesforceRecord>();
    for (const record of overallRaw.map(normalizeSalesforceMarketDataRecord)) {
      if (
        text(record, md.geographyLevel) !== OVERALL_MARKET_GEOGRAPHY_LEVEL ||
        text(record, md.geographyCode) !== OVERALL_MARKET_GEOGRAPHY_CODE ||
        text(record, md.submarket)
      )
        continue;
      const label = normalizeQuarterBounds(text(record, md.period)).label;
      if (overallByQuarter.has(label))
        throw new Error(
          `Market_Data__c Overall Market integrity failed: more than one ${OVERALL_MARKET_GEOGRAPHY_CODE} row for ${label}.`,
        );
      overallByQuarter.set(label, record);
    }
    const recordsBySubmarket = new Map<string, SalesforceRecord[]>();
    for (const record of current) {
      const canonical = canonicalChicagoSubmarket(text(record, md.submarket));
      if (canonical)
        recordsBySubmarket.set(canonical, [
          ...(recordsBySubmarket.get(canonical) ?? []),
          record,
        ]);
    }
    const missing = CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.filter(
      (name) => !recordsBySubmarket.has(name),
    );
    const duplicates = [...recordsBySubmarket]
      .filter(([, rows]) => rows.length > 1)
      .map(([name]) => name);
    if (missing.length || duplicates.length)
      throw new Error(
        `Market_Data__c snapshot integrity failed for ${bounds.label}. Missing: ${missing.join(", ") || "none"}. Duplicates: ${duplicates.join(", ") || "none"}.`,
      );
    const currentRecords = CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.map(
      (name) => recordsBySubmarket.get(name)![0],
    );
    const submarkets: SubmarketMetrics[] = currentRecords.map((record) => {
      const identity = resolveChicagoSubmarket(text(record, md.submarket))!;
      return {
        id: identity.id,
        canonicalName: identity.canonicalName,
        displayName: identity.displayName,
        name: identity.canonicalName,
        ...metrics(record),
      };
    });
    const marketDataIds = new Map(
      currentRecords.map((record) => [
        canonicalChicagoSubmarket(text(record, md.submarket))!,
        record.Id,
      ]),
    );
    const selectedNames: string[] =
      request.calculationScope.type === "all-submarkets"
        ? [...CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS]
        : request.calculationScope.submarkets.flatMap((name) => {
            const canonical = canonicalChicagoSubmarket(name);
            return canonical ? [canonical] : [];
          });
    if (!selectedNames.length)
      throw new Error(
        "The calculation scope does not contain an accepted Chicago Industrial submarket.",
      );
    const selectedPropertyRows = propertyRows.filter((record) => {
      const canonical = canonicalChicagoSubmarket(text(record, pd.submarket));
      return canonical ? selectedNames.includes(canonical) : false;
    });
    const requiresPropertyHeadline = !(
      request.calculationScope.type === "selected-submarkets" &&
      selectedNames.length === 1
    );
    // Full 18-submarket Chicago scope: the first-class Overall Market row for
    // the report quarter is the headline authority. Property_Data remains
    // detail / cross-check evidence only.
    const fullOverallScope =
      selectedNames.length === CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.length;
    const currentOverallRow = fullOverallScope
      ? overallByQuarter.get(bounds.label)
      : undefined;
    const overallHeadline = Boolean(currentOverallRow);
    if (fullOverallScope && !currentOverallRow)
      overallMarketDiagnostics.push(
        `${SUBMARKET_ROLLUP_FALLBACK}: no first-class ${OVERALL_MARKET_GEOGRAPHY_CODE} Market_Data__c row exists for ${bounds.label}; the Overall Market headline fell back to the Property_Data__c rollup.`,
      );
    if (requiresPropertyHeadline && !overallHeadline && !selectedPropertyRows.length)
      throw new Error(
        `No eligible Property_Data__c rows exist for the ${bounds.label} Overall Market calculation.`,
      );
    const propertyRollup = rollupPropertyData(
      selectedPropertyRows,
      submarkets.filter((row) => selectedNames.includes(row.name)),
    );
    const availabilityBySize =
      aggregateAvailabilityBySize(selectedPropertyRows);
    const overallMarket: OverallMarketMetrics = currentOverallRow
      ? overallMarketRowMetrics(currentOverallRow)
      : request.calculationScope.type === "selected-submarkets" &&
          selectedNames.length === 1
        ? metrics(recordsBySubmarket.get(selectedNames[0]!)![0])
        : propertyRollup.metrics;
    const propertyHeadline = requiresPropertyHeadline && !overallHeadline;
    const overallHeadlineExternalId = currentOverallRow
      ? text(currentOverallRow, md.externalId)
      : "";
    const headlineSource = overallHeadline
      ? `${OVERALL_MARKET_RECORD}: Market_Data__c first-class Overall Market row ${overallHeadlineExternalId}`
      : propertyHeadline
      ? "Property_Data__c eligible 20K+ rollup"
      : "Market_Data__c official submarket snapshot";

    const historyGroups = new Map<string, SalesforceRecord[]>();
    for (const record of history) {
      const label = normalizeQuarterBounds(text(record, md.period)).label;
      historyGroups.set(label, [...(historyGroups.get(label) ?? []), record]);
    }
    const incompleteHistory = [...historyGroups].filter(
      ([, rows]) =>
        new Set(
          rows
            .map((row) => canonicalChicagoSubmarket(text(row, md.submarket)))
            .filter(Boolean),
        ).size !== CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.length,
    );
    // With full Overall scope, a quarter that has a first-class Overall row
    // does not depend on its 18 submarket rows at all.
    const relevantIncompleteHistory = incompleteHistory.filter(
      ([label]) =>
        !(
          selectedNames.length === CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.length &&
          overallByQuarter.has(normalizeQuarterBounds(label).label)
        ),
    );
    const periodOrdinal = (label: string) => {
      const normalized = normalizeQuarterBounds(label);
      return normalized.year * 4 + normalized.quarter - 1;
    };
    const targetOrdinal = periodOrdinal(bounds.label);
    const scopedHistoryGroups = [...historyGroups].map(
      ([label, rows]) =>
        [
          label,
          rows.filter((record) => {
            const canonical = canonicalChicagoSubmarket(
              text(record, md.submarket),
            );
            return canonical ? selectedNames.includes(canonical) : false;
          }),
        ] as const,
    );
    const incompleteScopedHistory = scopedHistoryGroups.filter(
      ([, rows]) =>
        new Set(
          rows
            .map((row) => canonicalChicagoSubmarket(text(row, md.submarket)))
            .filter(Boolean),
        ).size !== selectedNames.length,
    );
    const submarketHistoricalPeriods = scopedHistoryGroups
      .filter(([label]) => periodOrdinal(label) <= targetOrdinal)
      .filter(
        ([label]) =>
          !incompleteScopedHistory.some(([period]) => period === label),
      )
      .map(([label, rows]) => aggregateQuarterlyMarketPeriod(label, rows));
    // Full Overall Market scope: ONE first-class Overall row IN = ONE quarter
    // OUT. A quarter whose Overall row exists is never rebuilt from
    // submarkets, and its null fields stay null (AUTHORITATIVE_NULL). Only a
    // quarter with no Overall row at all may use the diagnosed 18-submarket
    // rollup fallback.
    const fallbackQuarters: string[] = [];
    const authoritativePeriods = fullOverallScope
      ? (() => {
          const byLabel = new Map<
            string,
            ReturnType<typeof aggregateQuarterlyMarketPeriod>
          >();
          for (const [label, row] of overallByQuarter)
            if (periodOrdinal(label) <= targetOrdinal)
              byLabel.set(label, mapOverallMarketPeriod(label, row));
          for (const period of submarketHistoricalPeriods)
            if (!byLabel.has(period.period)) {
              byLabel.set(period.period, {
                ...period,
                source: {
                  authority: SUBMARKET_ROLLUP_FALLBACK,
                  quarter: period.period,
                },
              });
              fallbackQuarters.push(period.period);
            }
          return [...byLabel.values()];
        })()
      : submarketHistoricalPeriods;
    authoritativePeriods.sort(
      (left, right) => periodOrdinal(right.period) - periodOrdinal(left.period),
    );
    const quarterlyHistoricalPeriods = authoritativePeriods.slice(0, 12);
    // Trailing 12-month uses the same authoritative quarters (the full
    // continuous Overall series when available), never a separate submarket
    // sum. Submarket-scoped reports keep their existing 12-quarter window.
    const trailingInputs = fullOverallScope
      ? authoritativePeriods
      : quarterlyHistoricalPeriods;
    const trailingCalculations = new Map(
      quarterlyHistoricalPeriods.map((period) => [
        period.period,
        calculateTrailing12MonthNetAbsorption(trailingInputs, period.period),
      ]),
    );
    const usedFallbackQuarters = fallbackQuarters.filter((label) =>
      [...trailingCalculations.values()].some((trailing) =>
        trailing.inputPeriods.includes(label),
      ),
    );
    if (usedFallbackQuarters.length)
      overallMarketDiagnostics.push(
        `${SUBMARKET_ROLLUP_FALLBACK}: no first-class ${OVERALL_MARKET_GEOGRAPHY_CODE} Market_Data__c row exists for ${usedFallbackQuarters.sort().join(", ")}; those quarters were rolled up from the 18 submarket rows and are NOT equivalent authority.`,
      );
    const historicalPeriods = quarterlyHistoricalPeriods.map((period) => {
      const trailing = trailingCalculations.get(period.period)!;
      const { sourceIds: _sourceIds, ...metrics } = period;
      return {
        ...metrics,
        trailing12MonthNetAbsorptionSf: trailing.value,
        trailing12MonthNetAbsorptionStatus: trailing.status,
      };
    });

    const scoped = scopeHistoricalContributors(contributorRows, {
      period: bounds.label,
      submarkets: selectedNames,
      marketDataIds,
    });
    const detailScopes = CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.map((name) => ({
      name,
      scoped: scopeHistoricalContributors(contributorRows, {
        period: bounds.label,
        submarkets: [name],
        marketDataIds,
      }),
    }));
    // Top Sales are selected by Sold SF, which lives on the related Sale
    // (contributor rows carry no denormalized size for sales). Every eligible
    // Sale contributor row is therefore enriched BEFORE the size-ranked
    // selection runs in mapHistoricalContributors, instead of enriching only
    // a pre-selected (price-ranked) shortlist.
    const saleCandidates = [scoped, ...detailScopes.map((d) => d.scoped)]
      .flatMap((scope) => scope.rows)
      .filter((row) => contributorSection(row.Contributor_Category__c) === "sales");
    const finalists = [
      ...new Map(
        [
          ...selectContributorFinalists(scoped.rows),
          ...detailScopes.flatMap(({ scoped: detail }) =>
            selectContributorFinalists(detail.rows),
          ),
          ...saleCandidates,
        ].map((row) => [row.Id, row]),
      ).values(),
    ];
    const enrichmentDiagnostics: string[] = [];
    const saleContractDiagnostic = saleRankBasisMismatch(saleCandidates);
    if (saleContractDiagnostic) enrichmentDiagnostics.push(saleContractDiagnostic);
    await enrichFinalists(this.client, finalists, calls, enrichmentDiagnostics);
    const highlights = await mapHistoricalContributors(
      scoped.rows,
      this.resolveImage,
    );
    const detailHighlights = await Promise.all(
      detailScopes.map(({ scoped: detail }) =>
        mapHistoricalContributors(detail.rows, this.resolveImage),
      ),
    );
    const submarketDetails = CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.map(
      (name, detailIndex) => {
        const metricRow = submarkets.find((row) => row.name === name)!;
        const { name: _name, ...detailMetrics } = metricRow;
        const periods = [...historyGroups]
          .filter(([label]) => periodOrdinal(label) <= targetOrdinal)
          .flatMap(([label, rows]) => {
            const exact = rows.filter(
              (record) =>
                canonicalChicagoSubmarket(text(record, md.submarket)) === name,
            );
            return exact.length === 1
              ? [aggregateQuarterlyMarketPeriod(label, exact)]
              : [];
          })
          .sort(
            (left, right) =>
              periodOrdinal(right.period) - periodOrdinal(left.period),
          )
          .slice(0, 12);
        const history = periods.map((period) => {
          const trailing = calculateTrailing12MonthNetAbsorption(
            periods,
            period.period,
          );
          const { sourceIds: _sourceIds, ...periodMetrics } = period;
          return {
            ...periodMetrics,
            trailing12MonthNetAbsorptionSf: trailing.value,
            trailing12MonthNetAbsorptionStatus: trailing.status,
          };
        });
        // Governed market-explanation-v1 rows (the six "* Driver"
        // categories). Attached only when the engine published any, so
        // snapshots without them keep their existing shape and hash.
        const mapped = mapExplanatoryContributors(
          detailScopes[detailIndex]!.scoped.rows,
          "submarket",
        );
        explanationDiagnostics.push(...mapped.diagnostics);
        const explanatoryFacts = mapped.facts;
        return {
          ...(explanatoryFacts.length ? { explanatoryFacts } : {}),
          id: resolveChicagoSubmarket(name)!.id,
          canonicalName: name,
          displayName: resolveChicagoSubmarket(name)!.displayName,
          name,
          metrics: detailMetrics,
          historicalPeriods: history,
          narrative: "",
          leasing: detailHighlights[detailIndex]!.leasing,
          sales: detailHighlights[detailIndex]!.sales,
          availabilities: detailHighlights[detailIndex]!.availabilities,
          deliveries: detailHighlights[detailIndex]!.deliveries,
          construction: detailHighlights[detailIndex]!.construction,
          absorptionContributors:
            detailHighlights[detailIndex]!.absorptionContributors,
          availabilityBySize: aggregateAvailabilityBySize(
            propertyRows.filter(
              (record) =>
                canonicalChicagoSubmarket(text(record, pd.submarket)) === name,
            ),
          ),
        };
      },
    );
    // Overall Market market-explanation-v1 rows (all 18 submarkets plus
    // "Overall Market" are published upstream). Consumed as governed; Report
    // Studio never rebuilds the Overall Market causal bridge itself.
    const overallExplanation = mapExplanatoryContributors(
      overallMarketExplanationRows(contributorRows, bounds.label),
      "overall",
    );
    explanationDiagnostics.push(...overallExplanation.diagnostics);
    const retrievedAt = this.now().toISOString();
    const provenance: ProvenanceRecord[] = currentRecords.flatMap((record) => {
      const scope = canonicalChicagoSubmarket(text(record, md.submarket))!;
      const base: ProvenanceRecord[] = metricFields
        .filter(
          (entry) =>
            ![
              md.underConstructionAvailableSf,
              md.totalVacantSf,
              md.totalAvailableSf,
            ].includes(entry),
        )
        .map((entry) => {
          const key =
            Object.entries(md).find(
              ([, candidate]) => candidate === entry,
            )?.[0] ?? entry.apiName;
          return {
            fieldPath: `submarkets.${scope}.${key}`,
            selectedValue: value(record, entry),
            sources: [
              {
                sourceId: record.Id,
                sourceType: "salesforce" as const,
                value: value(record, entry),
                reference: `Market_Data__c.${entry.apiName}`,
                importedAt: retrievedAt,
              },
            ],
            authority: "Market_Data__c official quarter snapshot",
            metricType:
              key === "quarterlyNetAbsorptionSf" ? "quarterly" : undefined,
            status: "matched" as const,
            critical: [
              "inventorySf",
              "vacancyRate",
              "availabilityRate",
            ].includes(key),
          };
        });
      base.push({
        fieldPath: `submarkets.${scope}.speculativeShare`,
        selectedValue: speculativeShare(record),
        sources: [
          {
            sourceId: record.Id,
            sourceType: "calculated" as const,
            value: speculativeShare(record),
            reference:
              "Market_Data__c.Under_Construction_Available_SF__c / Under_Construction_SF__c",
            importedAt: retrievedAt,
          },
        ],
        authority: "verified-derived against live 2026 Q2 contract",
        status: "calculated" as const,
        critical: true,
      });
      return base;
    });
    for (const key of Object.keys(overallMarket) as (keyof MarketMetrics)[])
      provenance.push({
        fieldPath: `overallMarket.${key}`,
        selectedValue: overallMarket[key],
        sources: [
          {
            sourceId: currentOverallRow
              ? String(currentOverallRow.Id)
              : propertyHeadline
              ? `property-data-rollup-${bounds.label}`
              : marketDataIds.get(
                  canonicalChicagoSubmarket(selectedNames[0]!)!,
                )!,
            sourceType:
              propertyHeadline &&
              ["askingNetRentPsf", "quarterlyNetAbsorptionSf"].includes(key)
                ? "calculated"
                : "salesforce",
            value: overallMarket[key],
            reference: currentOverallRow
              ? `${OVERALL_MARKET_RECORD} ${overallHeadlineExternalId} (${bounds.label})${key === "speculativeShare" ? " Under_Construction_Available_SF__c / Under_Construction_SF__c" : ""}`
              : propertyHeadline
              ? key === "askingNetRentPsf"
                ? "Inventory-weighted Market_Data__c rent methodology"
                : key === "quarterlyNetAbsorptionSf"
                  ? `SUM(Property_Data__c.${pd.quarterlyNetAbsorptionSf.apiName}) across ${ELIGIBLE_MARKET_UNIVERSE_SCOPE} (${selectedPropertyRows.length} rows)`
                  : `Property_Data__c ${ELIGIBLE_MARKET_UNIVERSE_SCOPE} (${selectedPropertyRows.length} rows)`
              : `Market_Data__c official ${selectedNames[0]} snapshot`,
          },
        ],
        authority: headlineSource,
        metricType:
          key === "quarterlyNetAbsorptionSf" ? "quarterly" : undefined,
        status:
          propertyHeadline || key === "speculativeShare"
            ? "calculated"
            : "matched",
        ...(currentOverallRow
          ? {
              note: `Source authority ${OVERALL_MARKET_RECORD}: ${overallHeadlineExternalId}.`,
            }
          : {}),
        critical: [
          "inventorySf",
          "vacancyRate",
          "availabilityRate",
          "speculativeShare",
        ].includes(key),
        ...(currentOverallRow ? {} : {}),
        note:
          currentOverallRow
            ? key === "speculativeShare"
              ? `${OVERALL_MARKET_RECORD} ${overallHeadlineExternalId}: Under_Construction_Available_SF__c / Under_Construction_SF__c on the Overall row.`
              : `Source authority ${OVERALL_MARKET_RECORD}: ${overallHeadlineExternalId}.`
            : key === "speculativeShare"
            ? propertyHeadline
              ? "Verified-derived as SUM(Under_Construction_Available_SF__c) / SUM(Under_Construction_SF__c)."
              : "Verified-derived as Under_Construction_Available_SF__c / Under_Construction_SF__c."
            : undefined,
        calculation: {
          formula: currentOverallRow
            ? key === "speculativeShare"
              ? "Under_Construction_Available_SF__c / Under_Construction_SF__c (Overall Market row)"
              : `Market_Data__c.${key} (first-class Overall Market row, direct)`
            : propertyHeadline
            ? key === "vacancyRate"
              ? "SUM(Vacant_SF_Total__c) / SUM(Inventory_SF__c)"
              : key === "availabilityRate"
                ? "SUM(Available_SF_Total__c) / SUM(Inventory_SF__c)"
                : key === "speculativeShare"
                  ? "SUM(Under_Construction_Available_SF__c) / SUM(Under_Construction_SF__c)"
                  : key === "quarterlyNetAbsorptionSf"
                    ? `SUM(${pd.quarterlyNetAbsorptionSf.apiName})`
                    : `Property_Data__c rollup.${key}`
            : key === "speculativeShare"
              ? "Under_Construction_Available_SF__c / Under_Construction_SF__c"
              : `Market_Data__c.${key}`,
          inputPaths: currentOverallRow
            ? [`Market_Data__c.${overallHeadlineExternalId}.${key}`]
            : selectedNames.map(
                (name) =>
                  `${propertyHeadline ? "Property_Data__c" : "Market_Data__c"}.${name}.${key}`,
              ),
          inputCount: currentOverallRow
            ? 1
            : propertyHeadline
              ? selectedPropertyRows.length
              : 1,
        },
      });
    for (const bucket of availabilityBySize)
      provenance.push({
        fieldPath: `availabilityBySize.${bucket.bucket}.availableSf`,
        selectedValue: bucket.availableSf,
        sources: [
          {
            sourceId: `property-data-availability-${bucket.bucket.toLowerCase().replace(/\W+/g, "-")}`,
            sourceType: "calculated",
            value: bucket.availableSf,
            reference: `SUM(Property_Data__c.${pd.availableSf.apiName}) for ${bucket.bucket} across ${ELIGIBLE_MARKET_UNIVERSE_SCOPE} (${bucket.buildingCount} distinct buildings)`,
            importedAt: retrievedAt,
          },
        ],
        authority: "Property_Data__c eligible 20K+ availability-size rollup",
        status: "calculated",
        calculation: {
          formula: `SUM(${pd.availableSf.apiName}) within the governed half-open size bucket`,
          inputPaths: [
            `Property_Data__c.${pd.availableSf.apiName}`,
            `Property_Data__c.${pd.scope.apiName}`,
            `Property_Data__c.${pd.quarter.apiName}`,
            `Property_Data__c.${pd.submarket.apiName}`,
          ],
          inputCount: bucket.buildingCount,
          inputPeriods: [bounds.label],
          sourceObjects: ["Property_Data__c"],
        },
      });
    const historyById = new Map(
      [...history, ...overallByQuarter.values()].map((record) => [
        record.Id,
        record,
      ]),
    );
    const periodAuthority = (
      period: (typeof quarterlyHistoricalPeriods)[number],
    ) => period.source?.authority;
    const overallReference = (
      period: (typeof quarterlyHistoricalPeriods)[number],
      field: { apiName: string },
    ) =>
      `${OVERALL_MARKET_RECORD} ${period.source?.externalIds?.[0] ?? ""} Market_Data__c.${field.apiName} (${period.period})`;
    for (const period of quarterlyHistoricalPeriods) {
      const sourceIds = period.sourceIds ?? [];
      const quarterlySources = sourceIds.map((sourceId) => {
        const record = historyById.get(sourceId)!;
        return {
          sourceId,
          sourceType: "salesforce" as const,
          value: value(record, md.quarterlyNetAbsorptionSf),
          reference:
            periodAuthority(period) === OVERALL_MARKET_RECORD
              ? overallReference(period, md.quarterlyNetAbsorptionSf)
              : `Market_Data__c.${md.quarterlyNetAbsorptionSf.apiName} (${period.period} / ${text(record, md.submarket)})`,
          importedAt: retrievedAt,
        };
      });
      const isOverallRecord = periodAuthority(period) === OVERALL_MARKET_RECORD;
      const isFallback = periodAuthority(period) === SUBMARKET_ROLLUP_FALLBACK;
      const authorityLabel = (submarketLabel: string) =>
        isOverallRecord
          ? `${OVERALL_MARKET_RECORD}: Market_Data__c first-class Overall Market row`
          : isFallback
            ? `${SUBMARKET_ROLLUP_FALLBACK}: no Overall Market row for ${period.period}; ${submarketLabel}`
            : submarketLabel;
      const nullNote = (key: string) =>
        isOverallRecord && period.source?.authoritativeNulls?.includes(key)
          ? `AUTHORITATIVE_NULL: the ${OVERALL_MARKET_RECORD} for ${period.period} intentionally publishes no value; no other source was used.`
          : isFallback
            ? `${SUBMARKET_ROLLUP_FALLBACK}: diagnosed fallback, not equivalent to a first-class Overall row.`
            : undefined;
      provenance.push({
        fieldPath: `historicalPeriods.${period.period}.quarterlyNetAbsorptionSf`,
        selectedValue: period.quarterlyNetAbsorptionSf,
        sources: quarterlySources,
        authority: authorityLabel(
          selectedNames.length === 1
            ? "Market_Data__c official quarterly submarket snapshot"
            : `SUM(${selectedNames.length} accepted Market_Data__c quarterly submarket snapshots)`,
        ),
        metricType: "quarterly",
        status:
          isOverallRecord || selectedNames.length === 1 ? "matched" : "calculated",
        ...(nullNote("quarterlyNetAbsorptionSf")
          ? { note: nullNote("quarterlyNetAbsorptionSf") }
          : {}),
        calculation: {
          formula: isOverallRecord
            ? `Market_Data__c.${md.quarterlyNetAbsorptionSf.apiName} (first-class Overall Market row, direct)`
            : `SUM(Market_Data__c.${md.quarterlyNetAbsorptionSf.apiName})`,
          inputPaths: sourceIds.map(
            (sourceId) =>
              `Market_Data__c.${sourceId}.${md.quarterlyNetAbsorptionSf.apiName}`,
          ),
          inputCount: sourceIds.length,
          inputPeriods: [period.period],
          sourceObjects: ["Market_Data__c"],
        },
      });
      const chartMetrics = [
        [
          "vacancyRate",
          period.vacancyRate,
          md.vacancyRate,
          "ratio of summed vacant SF to inventory",
        ],
        [
          "availabilityRate",
          period.availabilityRate,
          md.availabilityRate,
          "ratio of summed available SF to inventory",
        ],
        [
          "underConstructionSf",
          period.underConstructionSf,
          md.underConstructionSf,
          "sum",
        ],
        ["deliveredSf", period.deliveredSf, md.deliveredSf, "sum"],
        ["salesVolume", period.salesVolume, md.salesVolume, "sum"],
        [
          "salesTransactions",
          period.salesTransactions,
          md.salesTransactions,
          "sum of governed qualifying Sale transaction counts",
        ],
        [
          "medianSalesPricePsf",
          period.medianSalesPricePsf,
          md.medianSalesPricePerBuildingSf,
          selectedNames.length === 1
            ? "direct verified Market_Data__c submarket median"
            : "unavailable: a true transaction median cannot be derived from aggregate submarket medians",
        ],
        [
          "leasingActivitySf",
          period.leasingActivitySf,
          md.leasingActivitySf,
          "sum",
        ],
      ] as const;
      for (const [key, selectedValue, field, formula] of chartMetrics)
        provenance.push({
          fieldPath: `historicalPeriods.${period.period}.${key}`,
          selectedValue,
          sources: sourceIds.map((sourceId) => {
            const record = historyById.get(sourceId)!;
            return {
              sourceId,
              sourceType: "salesforce" as const,
              value: value(record, field),
              reference: isOverallRecord
                ? overallReference(period, field)
                : `Market_Data__c.${field.apiName} (${period.period} / ${text(record, md.submarket)})`,
              importedAt: retrievedAt,
            };
          }),
          authority: authorityLabel(
            selectedNames.length === 1
              ? "Market_Data__c official quarterly submarket snapshot"
              : "Accepted Market_Data__c quarterly submarket aggregation",
          ),
          status:
            isOverallRecord || selectedNames.length === 1
              ? ("matched" as const)
              : ("calculated" as const),
          ...(nullNote(key) ? { note: nullNote(key) } : {}),
          calculation: {
            formula: isOverallRecord
              ? `Market_Data__c.${field.apiName} (first-class Overall Market row, direct)`
              : formula,
            inputPaths: sourceIds.map(
              (sourceId) => `Market_Data__c.${sourceId}.${field.apiName}`,
            ),
            inputCount: sourceIds.length,
            inputPeriods: [period.period],
            sourceObjects: ["Market_Data__c"],
          },
        });
      const trailing = trailingCalculations.get(period.period)!;
      const trailingSources = trailing.sourceIds.map((sourceId) => {
        const record = historyById.get(sourceId)!;
        return {
          sourceId,
          sourceType: "salesforce" as const,
          value: value(record, md.quarterlyNetAbsorptionSf),
          reference: text(record, md.submarket)
            ? `Market_Data__c.${md.quarterlyNetAbsorptionSf.apiName} (${text(record, md.period)} / ${text(record, md.submarket)})`
            : `${OVERALL_MARKET_RECORD} ${text(record, md.externalId)} Market_Data__c.${md.quarterlyNetAbsorptionSf.apiName} (${text(record, md.period)})`,
          importedAt: retrievedAt,
        };
      });
      provenance.push({
        fieldPath: `historicalPeriods.${period.period}.trailing12MonthNetAbsorptionSf`,
        selectedValue: trailing.value,
        sources: trailingSources.length
          ? trailingSources
          : [
              {
                sourceId: `market-data-history-${period.period}`,
                sourceType: "calculated" as const,
                value: null,
                reference: "No quarterly Market_Data__c history was available.",
                importedAt: retrievedAt,
              },
            ],
        authority: "verified-derived trailing four-quarter calculation",
        metricType: "trailing-12-month",
        status: "calculated",
        note:
          trailing.status === "complete"
            ? "Signed sum of the target quarter and immediately preceding three quarters."
            : trailing.status === "authoritative_null"
              ? `AUTHORITATIVE_NULL: ${trailing.nullPeriods?.join(", ")} publish no net absorption on the first-class Overall Market row, so the trailing value is unavailable. No other source was used.`
              : `Insufficient history; missing ${trailing.missingPeriods.join(", ")}. Missing quarters were not treated as zero.`,
        calculation: {
          formula: `SUM(quarterlyNetAbsorptionSf for ${trailing.inputPeriods.join(", ")})`,
          inputPaths: trailing.inputPeriods.map(
            (inputPeriod) =>
              `historicalPeriods.${inputPeriod}.quarterlyNetAbsorptionSf`,
          ),
          inputCount: trailing.inputPeriods.length,
          inputPeriods: trailing.inputPeriods,
          sourceObjects: ["Market_Data__c"],
        },
      });
    }
    for (const name of CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS) {
      const official = submarkets.find((row) => row.name === name)!.inventorySf;
      const propertyInventory = propertyRows
        .filter(
          (row) => canonicalChicagoSubmarket(text(row, pd.submarket)) === name,
        )
        .reduce(
          (total, row) => total + Number(value(row, pd.inventorySf) ?? 0),
          0,
        );
      const varianceAbsolute = Math.abs(propertyInventory - official);
      const knownWestCook =
        bounds.label === "2026 Q2" &&
        name === "West Cook" &&
        Math.abs(varianceAbsolute - 82_000) <= 1;
      const reconciliation = classifyInventoryReconciliation({
        authoritativeInventory: official,
        propertyDataInventory: propertyInventory,
        knownDifference: knownWestCook,
        knownDifferenceReason: knownWestCook
          ? "Known Q2 West Cook parent-linked Property_Data reconciliation difference."
          : undefined,
      });
      provenance.push({
        fieldPath: `reconciliation.submarkets.${name}.inventorySf`,
        selectedValue: official,
        sources: [
          {
            sourceId: marketDataIds.get(name)!,
            sourceType: "salesforce",
            value: official,
            reference: "Market_Data__c.Inventory_SF__c",
          },
          {
            sourceId: `property-data-reconciliation-${name}`,
            sourceType: "calculated",
            value: propertyInventory,
            reference: "SUM(Property_Data__c.Inventory_SF__c)",
          },
        ],
        authority: "Market_Data__c official submarket snapshot",
        status:
          reconciliation.classification === "matched"
            ? "matched"
            : reconciliation.classification === "known-difference"
              ? "reconciled"
              : "conflict",
        critical: reconciliation.classification === "blocking",
        note: reconciliation.message,
        reconciliation: {
          classification: reconciliation.classification,
          authoritativeValue: reconciliation.authoritativeValue,
          comparisonValue: reconciliation.comparisonValue,
          varianceAbsolute: reconciliation.varianceAbsolute,
          variancePercentage: reconciliation.variancePercentage,
          reason: reconciliation.reason,
          details:
            reconciliation.classification === "matched"
              ? undefined
              : buildInventoryReconciliationDetails({
                  rows: propertyRows,
                  submarket: name,
                  varianceAbsolute:
                    reconciliation.varianceAbsolute ?? varianceAbsolute,
                  period: bounds.label,
                  scope: ELIGIBLE_MARKET_UNIVERSE_SCOPE,
                  knownDifference: knownWestCook,
                }),
        },
      });
    }
    if (propertyRollup.facts.unlinkedMarketDataRows)
      provenance.push({
        fieldPath: "reconciliation.propertyData.unlinkedMarketDataRows",
        selectedValue: propertyRollup.facts.unlinkedMarketDataRows,
        sources: [
          {
            sourceId: `property-data-rollup-${bounds.label}`,
            sourceType: "salesforce",
            value: propertyRollup.facts.unlinkedMarketDataRows,
            reference: "Property_Data__c.Market_Data__c = NULL",
          },
        ],
        authority: "Eligible Property_Data rollup with parent-link QA",
        status: "reconciled",
        note: "Eligible unlinked Property_Data rows remain included in Overall Market and are excluded only from parent-linked reconciliation.",
      });
    provenance.push(
      ...relevantIncompleteHistory.map(([label, rows]) => ({
        fieldPath: `historicalPeriods.${label}.submarketIntegrity`,
        selectedValue: rows.length,
        sources: [
          {
            sourceId: `market-data-history-${label}`,
            sourceType: "salesforce" as const,
            value: rows.length,
            reference: "Market_Data__c accepted submarket snapshots",
          },
        ],
        authority: "18 Market_Data__c snapshots per historical quarter",
        status: "conflict" as const,
        critical: true,
        note: `${label} does not contain exactly 18 unique accepted submarket snapshots.`,
      })),
    );
    provenance.push(
      ...highlights.provenance,
      ...detailHighlights.flatMap((detail, index) =>
        detail.provenance.map((record) => ({
          ...record,
          fieldPath: `submarketDetails.${CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS[index]}.${record.fieldPath}`,
        })),
      ),
      ...scoped.issues.map((issue) => ({
        fieldPath: `contributors.${issue.contributorId}.parentConsistency`,
        selectedValue: false,
        sources: [
          {
            sourceId: issue.contributorId,
            sourceType: "salesforce" as const,
            value: issue.reason,
            reference: "Market_Data_Contributor__c.Market_Data__c",
          },
        ],
        authority: "Historical contributor parent integrity",
        status: "conflict" as const,
        critical: true,
        note: issue.reason,
      })),
    );
    const queryOperations =
      calls.marketData +
      calls.contributor +
      calls.propertyData +
      calls.enrichment +
      calls.capability;
    const measuredApiCalls = this.client.getApiCallCount
      ? this.client.getApiCallCount() - apiCallsBefore
      : queryOperations;
    const report: IndustrialMarketReport = {
      report: {
        id: `${request.market.toLowerCase().replace(/\W+/g, "-")}-${bounds.label.toLowerCase().replace(/\W+/g, "-")}`,
        title: "Industrial Market Report",
        templateId: "industrial-market-report",
        market: request.market,
        period: bounds.label,
        preparedBy: "Lee & Associates",
      },
      overallMarket: { ...overallMarket, narrative: "" },
      submarkets,
      submarketDetails,
      historicalPeriods,
      leasing: highlights.leasing,
      sales: highlights.sales,
      availabilities: highlights.availabilities,
      deliveries: highlights.deliveries,
      construction: highlights.construction,
      absorptionContributors: highlights.absorptionContributors,
      ...(overallExplanation.facts.length
        ? { explanatoryFacts: overallExplanation.facts }
        : {}),
      availabilityBySize,
      provenance,
      presentationOverrides: [],
      dataCompleteness: [
        {
          section: "narrative",
          status: "missing",
          sourceIds: [],
          note: "Narrative is maintained outside Market_Data__c.",
        },
        ...(relevantIncompleteHistory.length
          ? [
              {
                section: "historicalPeriods" as const,
                status: "partial" as const,
                sourceIds: ["Market_Data__c"],
                note: "One or more historical quarters lacks the required 18 unique accepted submarket snapshots.",
              },
            ]
          : []),
      ],
    };
    return {
      report,
      recordCounts: {
        marketData: current.length,
        historicalMarketData: history.length,
        propertyData: propertyRows.length,
        contributors: contributorRows.length,
        finalistContributors: finalists.length,
        leases: highlights.leasing.length,
        sales: highlights.sales.length,
        availabilities: highlights.availabilities.length,
        deliveries: highlights.deliveries.length,
        construction: highlights.construction.length,
      },
      diagnostics: [
        `Salesforce API calls: measured=${measuredApiCalls}; queryOperations=${queryOperations}; Market_Data=${calls.marketData}; Contributor=${calls.contributor}; Property_Data=${calls.propertyData}; Enrichment=${calls.enrichment}; Capability=${calls.capability}`,
        ...overallMarketDiagnostics,
        ...enrichmentDiagnostics,
        ...explanationDiagnostics,
        ...highlights.imageWarnings,
        ...detailHighlights.flatMap((detail) => detail.imageWarnings),
        ...scoped.issues.map((issue) => issue.reason),
        ...(propertyRollup.facts.unlinkedMarketDataRows
          ? [
              `Property_Data QA: ${propertyRollup.facts.unlinkedMarketDataRows} eligible row(s) have no Market_Data__c link and remain included.`,
            ]
          : []),
      ],
      sourceDefinition: {
        period: bounds.label,
        geography:
          selectedNames.length === 18
            ? "Overall Market"
            : selectedNames.join(", "),
        headlineSource,
        trendSource: fullOverallScope
          ? usedFallbackQuarters.length
            ? `${OVERALL_MARKET_RECORD} first-class Market_Data__c Overall Market rows; ${SUBMARKET_ROLLUP_FALLBACK} for ${usedFallbackQuarters.join(", ")}`
            : `${OVERALL_MARKET_RECORD} first-class Market_Data__c Overall Market rows`
          : "18 Market_Data__c submarket snapshots",
        contributorSource:
          "Market_Data_Contributor__c pooled/scoped historical snapshots",
        apiCallCounts: {
          ...calls,
          queryOperations,
          measuredApiCalls,
          total: measuredApiCalls,
        },
        propertyDataRollup: propertyRollup.facts,
      },
    };
  }
  async health() {
    return { ...(await this.client.health()), mode: "salesforce" as const };
  }
}
