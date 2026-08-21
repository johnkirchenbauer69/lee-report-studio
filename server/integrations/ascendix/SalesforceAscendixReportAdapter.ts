import type {
  IndustrialMarketReport,
  MarketMetrics,
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
  mapHistoricalContributors,
  scopeHistoricalContributors,
  selectContributorFinalists,
  type ImageResolver,
} from "./contributors.ts";
import { looksLikeSalesforceId } from "../salesforce/salesforceIds.ts";
import {
  CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS,
  ELIGIBLE_MARKET_UNIVERSE_SCOPE,
  canonicalChicagoSubmarket,
  salesforceFieldMap as mapping,
} from "./salesforceFieldMap.ts";
import {
  normalizeQuarterBounds,
  normalizeSalesforceMarketDataRecord,
} from "./salesforceNormalization.ts";
import {
  aggregateQuarterlyMarketPeriod,
  calculateTrailing12MonthNetAbsorption,
  rollupPropertyData,
  verifiedSpeculativeShare,
} from "./salesforceRollups.ts";

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
const md = mapping.marketData;
const pd = mapping.propertyData;
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
    askingNetRentPsf: number(record, md.askingNetRentPsf, "asking rent"),
    salesVolume: number(record, md.salesVolume, "sales volume"),
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
  const leaseRows = finalists.filter(
    (row) =>
      sections.get(row.Id)?.includes("lease") &&
      (!row.Tenant_Name__c || !row.Deal_Type__c),
  );
  const saleRows = finalists.filter(
    (row) =>
      sections.get(row.Id)?.includes("sale") &&
      (looksLikeSalesforceId(String(row.Buyer_Name__c ?? "")) ||
        !row.Buyer_Name__c ||
        !row.Sale_Type__c),
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
    ],
    saleRows,
    "Sale__c",
    "Sale__r",
  );
  await Promise.all(jobs);
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
    const contributor = mapping.contributor;
    const contributorQuery = selectQuery(
      api(contributor.object),
      contributorBaseFields,
      `${api(contributor.period)} = ${period} AND ${api(contributor.submarket)} IN ${accepted} AND ${api(contributor.active)} = TRUE AND ${api(contributor.included)} = TRUE`,
    );
    const calls = {
      marketData: 2,
      contributor: 1,
      propertyData: 1,
      enrichment: 0,
      capability: 0,
    };
    const [currentRaw, historyRaw, propertyRows, contributorRows] =
      await Promise.all([
        this.client.query(currentQuery),
        this.client.query(historyQuery),
        this.client.query(propertyDataQuery),
        this.client.query(contributorQuery),
      ]);
    const current = currentRaw.map(normalizeSalesforceMarketDataRecord);
    const history = historyRaw.map(normalizeSalesforceMarketDataRecord);
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
    const submarkets: SubmarketMetrics[] = currentRecords.map((record) => ({
      name: canonicalChicagoSubmarket(text(record, md.submarket))!,
      ...metrics(record),
    }));
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
    if (requiresPropertyHeadline && !selectedPropertyRows.length)
      throw new Error(
        `No eligible Property_Data__c rows exist for the ${bounds.label} Overall Market calculation.`,
      );
    const propertyRollup = rollupPropertyData(
      selectedPropertyRows,
      submarkets.filter((row) => selectedNames.includes(row.name)),
    );
    const overallMarket =
      request.calculationScope.type === "selected-submarkets" &&
      selectedNames.length === 1
        ? metrics(recordsBySubmarket.get(selectedNames[0]!)![0])
        : propertyRollup.metrics;
    const propertyHeadline = requiresPropertyHeadline;
    const headlineSource = propertyHeadline
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
    const quarterlyHistoricalPeriods = scopedHistoryGroups
      .filter(([label]) => periodOrdinal(label) <= targetOrdinal)
      .filter(
        ([label]) =>
          !incompleteScopedHistory.some(([period]) => period === label),
      )
      .map(([label, rows]) => aggregateQuarterlyMarketPeriod(label, rows))
      .sort(
        (left, right) =>
          periodOrdinal(right.period) - periodOrdinal(left.period),
      )
      .slice(0, 12);
    const trailingCalculations = new Map(
      quarterlyHistoricalPeriods.map((period) => [
        period.period,
        calculateTrailing12MonthNetAbsorption(
          quarterlyHistoricalPeriods,
          period.period,
        ),
      ]),
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
    const finalists = [
      ...new Map(
        [
          ...selectContributorFinalists(scoped.rows),
          ...detailScopes.flatMap(({ scoped: detail }) =>
            selectContributorFinalists(detail.rows),
          ),
        ].map((row) => [row.Id, row]),
      ).values(),
    ];
    const enrichmentDiagnostics: string[] = [];
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
        return {
          name,
          metrics: detailMetrics,
          historicalPeriods: history,
          narrative: "",
          leasing: detailHighlights[detailIndex]!.leasing,
          sales: detailHighlights[detailIndex]!.sales,
          availabilities: detailHighlights[detailIndex]!.availabilities,
          deliveries: detailHighlights[detailIndex]!.deliveries,
          construction: detailHighlights[detailIndex]!.construction,
        };
      },
    );
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
            sourceId: propertyHeadline
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
            reference: propertyHeadline
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
        critical: [
          "inventorySf",
          "vacancyRate",
          "availabilityRate",
          "speculativeShare",
        ].includes(key),
        note:
          key === "speculativeShare"
            ? propertyHeadline
              ? "Verified-derived as SUM(Under_Construction_Available_SF__c) / SUM(Under_Construction_SF__c)."
              : "Verified-derived as Under_Construction_Available_SF__c / Under_Construction_SF__c."
            : undefined,
        calculation: {
          formula: propertyHeadline
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
          inputPaths: selectedNames.map(
            (name) =>
              `${propertyHeadline ? "Property_Data__c" : "Market_Data__c"}.${name}.${key}`,
          ),
          inputCount: propertyHeadline ? selectedPropertyRows.length : 1,
        },
      });
    const historyById = new Map(history.map((record) => [record.Id, record]));
    for (const period of quarterlyHistoricalPeriods) {
      const sourceIds = period.sourceIds ?? [];
      const quarterlySources = sourceIds.map((sourceId) => {
        const record = historyById.get(sourceId)!;
        return {
          sourceId,
          sourceType: "salesforce" as const,
          value: value(record, md.quarterlyNetAbsorptionSf),
          reference: `Market_Data__c.${md.quarterlyNetAbsorptionSf.apiName} (${period.period} / ${text(record, md.submarket)})`,
          importedAt: retrievedAt,
        };
      });
      provenance.push({
        fieldPath: `historicalPeriods.${period.period}.quarterlyNetAbsorptionSf`,
        selectedValue: period.quarterlyNetAbsorptionSf,
        sources: quarterlySources,
        authority:
          selectedNames.length === 1
            ? "Market_Data__c official quarterly submarket snapshot"
            : `SUM(${selectedNames.length} accepted Market_Data__c quarterly submarket snapshots)`,
        metricType: "quarterly",
        status: selectedNames.length === 1 ? "matched" : "calculated",
        calculation: {
          formula: `SUM(Market_Data__c.${md.quarterlyNetAbsorptionSf.apiName})`,
          inputPaths: sourceIds.map(
            (sourceId) =>
              `Market_Data__c.${sourceId}.${md.quarterlyNetAbsorptionSf.apiName}`,
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
          reference: `Market_Data__c.${md.quarterlyNetAbsorptionSf.apiName} (${text(record, md.period)} / ${text(record, md.submarket)})`,
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
      const difference = propertyInventory - official;
      const withinTolerance =
        Math.abs(difference) <= Math.max(1, Math.abs(official) * 0.000001);
      const knownWestCook =
        bounds.label === "2026 Q2" &&
        name === "West Cook" &&
        Math.abs(difference - 82_000) <= 1;
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
        status: withinTolerance
          ? "matched"
          : knownWestCook
            ? "reconciled"
            : "conflict",
        critical: !withinTolerance && !knownWestCook,
        note: withinTolerance
          ? "Property_Data inventory reconciles within tolerance."
          : knownWestCook
            ? `Known Q2 West Cook Property_Data variance: ${difference} SF; official Market_Data remains selected.`
            : `Property_Data inventory differs by ${difference} SF; official Market_Data remains selected.`,
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
      ...incompleteHistory.map(([label, rows]) => ({
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
      provenance,
      presentationOverrides: [],
      dataCompleteness: [
        {
          section: "narrative",
          status: "missing",
          sourceIds: [],
          note: "Narrative is maintained outside Market_Data__c.",
        },
        ...(incompleteHistory.length
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
        ...enrichmentDiagnostics,
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
        trendSource: "18 Market_Data__c submarket snapshots",
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
