import type {
  HistoricalMarketPeriod,
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
import { selectQuery, soqlLiteral } from "../salesforce/soql.ts";
import type { AscendixReportAdapter } from "./AscendixReportAdapter.ts";
import { mapHistoricalContributors } from "./contributors.ts";
import {
  contributorOptionalRelationshipFields,
  isPublicExcludedSubmarket,
  salesforceFieldMap as mapping,
} from "./salesforceFieldMap.ts";
import {
  normalizeQuarterBounds,
  normalizeSalesforceMarketDataRecord,
} from "./salesforceNormalization.ts";

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
const metricFields = [
  md.inventorySf,
  md.deliveredSf,
  md.underConstructionSf,
  md.underConstructionAvailableSf,
  md.netAbsorptionSf,
  md.vacancyRate,
  md.availabilityRate,
  md.askingNetRentPsf,
  md.salesVolume,
] as const;

function candidateSpeculativeShare(record: SalesforceRecord) {
  const total = number(
    record,
    md.underConstructionSf,
    "under construction area",
  );
  const available = number(
    record,
    md.underConstructionAvailableSf,
    "under construction available area",
  );
  return total > 0 ? Math.min(1, Math.max(0, available / total)) : 0;
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
    speculativeShare: candidateSpeculativeShare(record),
    netAbsorptionSf: number(record, md.netAbsorptionSf, "net absorption"),
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
  .map(api);

async function loadContributors(client: SalesforceClient, period: string) {
  const object = api(mapping.contributor.object);
  const where = `${api(mapping.contributor.period)} = ${soqlLiteral(period, "period")} AND ${api(mapping.contributor.active)} = TRUE AND ${api(mapping.contributor.included)} = TRUE`;
  const rows = await client.query(
    selectQuery(object, contributorBaseFields, where),
  );
  const byId = new Map(rows.map((row) => [row.Id, row]));
  const unavailable: string[] = [];
  await Promise.all(
    contributorOptionalRelationshipFields.map(async (field) => {
      try {
        const enrichment = await client.query(
          selectQuery(object, ["Id", field], where),
        );
        for (const record of enrichment) {
          const target = byId.get(record.Id);
          if (target) Object.assign(target, record);
        }
      } catch {
        unavailable.push(field);
      }
    }),
  );
  return { rows: [...byId.values()], unavailable };
}

export class SalesforceAscendixReportAdapter implements AscendixReportAdapter {
  constructor(
    private readonly client: SalesforceClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async loadReportSource(request: ReportDataRequest) {
    if (request.timeContext.type === "current")
      throw new Error(
        "Current Salesforce report mapping is not configured yet; use a historical-period request.",
      );
    const bounds = normalizeQuarterBounds(request.period);
    const market = soqlLiteral(request.market, "market");
    const period = soqlLiteral(bounds.label, "period");
    const marketFields = [
      md.id,
      md.name,
      md.market,
      md.marketCode,
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
      `${api(md.market)} = ${market} AND ${api(md.period)} = ${period}`,
    );
    const historyQuery = selectQuery(
      api(md.object),
      marketFields,
      `${api(md.market)} = ${market} AND ${api(md.submarket)} = NULL`,
      ` ORDER BY ${api(md.period)} DESC LIMIT 12`,
    );
    const [currentRaw, historyRaw, contributors] = await Promise.all([
      this.client.query(currentQuery),
      this.client.query(historyQuery),
      loadContributors(this.client, bounds.label),
    ]);
    if (!currentRaw.length)
      throw new Error(
        `No Market_Data__c record exists for ${request.market} / ${bounds.label}.`,
      );
    const current = currentRaw.map(normalizeSalesforceMarketDataRecord);
    const history = historyRaw.map(normalizeSalesforceMarketDataRecord);
    const aggregate = current.find((record) => {
      const name = text(record, md.submarket);
      return !name || name.toLocaleLowerCase() === "overall market";
    });
    const submarkets: SubmarketMetrics[] = current
      .filter((record) => {
        const name = text(record, md.submarket);
        return (
          Boolean(name) &&
          name.toLocaleLowerCase() !== "overall market" &&
          !isPublicExcludedSubmarket(name)
        );
      })
      .map((record) => ({
        name: text(record, md.submarket),
        ...metrics(record),
      }));
    if (!aggregate && !submarkets.length)
      throw new Error(
        "Historical report data is incomplete: no aggregate or eligible public submarket records were returned.",
      );
    const retrievedAt = this.now().toISOString();
    const sourceProvenance: ProvenanceRecord[] = current
      .filter((record) => {
        const name = text(record, md.submarket);
        return (
          !name ||
          name.toLocaleLowerCase() === "overall market" ||
          !isPublicExcludedSubmarket(name)
        );
      })
      .flatMap((record) => {
        const scope = text(record, md.submarket) || "overallMarket";
        return metricFields
          .filter((entry) => entry !== md.underConstructionAvailableSf)
          .map((entry) => {
            const key =
              Object.entries(md).find(
                ([, candidate]) => candidate === entry,
              )?.[0] ?? entry.apiName;
            return {
              fieldPath:
                scope.toLocaleLowerCase() === "overall market" ||
                scope === "overallMarket"
                  ? `overallMarket.${key}`
                  : `submarkets.${scope}.${key}`,
              selectedValue: value(record, entry),
              sources: [
                {
                  sourceId: record.Id,
                  sourceType: "salesforce" as const,
                  value: value(record, entry),
                  reference: `${api(md.object)}.${entry.apiName}`,
                  importedAt: retrievedAt,
                },
              ],
              authority: `${api(md.object)} historical record selected by Quarter_Label__c`,
              status: "matched" as const,
              critical: [
                "vacancyRate",
                "availabilityRate",
                "inventorySf",
              ].includes(key),
            };
          });
      });
    sourceProvenance.push({
      fieldPath: "overallMarket.speculativeShare",
      selectedValue: aggregate ? candidateSpeculativeShare(aggregate) : 0,
      sources: [
        {
          sourceId: aggregate?.Id ?? "candidate-derived",
          sourceType: "calculated",
          value: aggregate ? candidateSpeculativeShare(aggregate) : 0,
          reference:
            "Under_Construction_Available_SF__c / Under_Construction_SF__c",
        },
      ],
      authority: "Candidate calculation only; business definition unverified",
      status: "calculated",
      critical: true,
      note: "Construction speculative share remains derived-unverified and must be reconciled against the approved Q2 report before it is authoritative.",
    });
    const historicalPeriods: HistoricalMarketPeriod[] = history.map(
      (record) => ({
        period: text(record, md.period),
        netAbsorption12MonthSf: number(
          record,
          md.netAbsorptionSf,
          "net absorption",
        ),
        vacancyRate: rate(record, md.vacancyRate, "vacancy rate"),
        availabilityRate: rate(
          record,
          md.availabilityRate,
          "availability rate",
        ),
        underConstructionSf: number(
          record,
          md.underConstructionSf,
          "under construction area",
        ),
        leasingActivitySf: number(
          record,
          md.leasingActivitySf,
          "leasing activity",
        ),
      }),
    );
    const highlights = mapHistoricalContributors(contributors.rows);
    const zero: MarketMetrics = {
      inventorySf: 0,
      deliveredSf: 0,
      underConstructionSf: 0,
      speculativeShare: 0,
      netAbsorptionSf: 0,
      vacancyRate: 0,
      availabilityRate: 0,
      askingNetRentPsf: 0,
      salesVolume: 0,
    };
    const report: IndustrialMarketReport = {
      report: {
        id: `${request.market.toLowerCase().replace(/\W+/g, "-")}-${bounds.label.toLowerCase().replace(/\W+/g, "-")}`,
        title: "Industrial Market Report",
        templateId: "industrial-market-report",
        market: request.market,
        period: bounds.label,
        preparedBy: "Lee & Associates",
      },
      overallMarket: {
        ...(aggregate ? metrics(aggregate) : zero),
        narrative: "",
      },
      submarkets,
      historicalPeriods,
      leasing: highlights.leasing,
      sales: highlights.sales,
      availabilities: highlights.availabilities,
      deliveries: highlights.deliveries,
      construction: highlights.construction,
      provenance: [...sourceProvenance, ...highlights.provenance],
      presentationOverrides: [],
      dataCompleteness: [
        {
          section: "narrative",
          status: "missing",
          sourceIds: [],
          note: "Market_Data__c has no verified authoritative narrative field.",
        },
        {
          section: "overallMarket",
          status: "partial",
          sourceIds: [aggregate?.Id ?? "submarket-calculation"],
          note: "speculativeShare is a derived-unverified candidate pending approved-report reconciliation.",
        },
      ],
    };
    return {
      report,
      recordCounts: {
        marketData: current.length,
        historicalPeriods: history.length,
        contributors: contributors.rows.length,
        leases: highlights.leasing.length,
        sales: highlights.sales.length,
        availabilities: highlights.availabilities.length,
        deliveries: highlights.deliveries.length,
        construction: highlights.construction.length,
      },
      diagnostics: contributors.unavailable.map(
        (field) =>
          `Optional contributor relationship field unavailable: ${field}`,
      ),
    };
  }
  async health() {
    return { ...(await this.client.health()), mode: "salesforce" as const };
  }
}
