import type {
  HistoricalMarketPeriod,
  IndustrialMarketReport,
  LeaseRecord,
  MarketMetrics,
  PropertyHighlight,
  ProvenanceRecord,
  SaleRecord,
  SubmarketMetrics,
} from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { ReportDataRequest } from "../../report-data-service/contracts.ts";
import type {
  SalesforceClient,
  SalesforceRecord,
} from "../salesforce/SalesforceClient.ts";
import { selectQuery, soqlLiteral } from "../salesforce/soql.ts";
import type { AscendixReportAdapter } from "./AscendixReportAdapter.ts";
import { salesforceFieldMap as mapping } from "./salesforceFieldMap.ts";

const api = (entry: { apiName: string } | string) =>
  typeof entry === "string" ? entry : entry.apiName;
const value = (record: SalesforceRecord, entry: { apiName: string }) =>
  record[entry.apiName];
const text = (
  record: SalesforceRecord,
  entry: { apiName: string },
  fallback = "",
) => {
  const found = value(record, entry);
  return found == null ? fallback : String(found).trim();
};
const requiredText = (
  record: SalesforceRecord,
  entry: { apiName: string },
  label: string,
) => {
  const found = text(record, entry);
  if (!found) throw new Error(`Salesforce returned a missing ${label}.`);
  return found;
};
const number = (
  record: SalesforceRecord,
  entry: { apiName: string },
  label: string,
) => {
  const sourceValue = value(record, entry);
  if (sourceValue === null || sourceValue === undefined || sourceValue === "") {
    throw new Error(`Salesforce returned a missing ${label}.`);
  }
  const found = Number(sourceValue);
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

const metricFields = [
  mapping.marketData.inventorySf,
  mapping.marketData.deliveredSf,
  mapping.marketData.underConstructionSf,
  mapping.marketData.speculativeShare,
  mapping.marketData.netAbsorptionSf,
  mapping.marketData.vacancyRate,
  mapping.marketData.availabilityRate,
  mapping.marketData.askingNetRentPsf,
  mapping.marketData.salesVolume,
] as const;

function metrics(record: SalesforceRecord): MarketMetrics {
  return {
    inventorySf: number(record, mapping.marketData.inventorySf, "inventory"),
    deliveredSf: number(
      record,
      mapping.marketData.deliveredSf,
      "delivered area",
    ),
    underConstructionSf: number(
      record,
      mapping.marketData.underConstructionSf,
      "under construction area",
    ),
    speculativeShare: rate(
      record,
      mapping.marketData.speculativeShare,
      "speculative share",
    ),
    netAbsorptionSf: number(
      record,
      mapping.marketData.netAbsorptionSf,
      "net absorption",
    ),
    vacancyRate: rate(record, mapping.marketData.vacancyRate, "vacancy rate"),
    availabilityRate: rate(
      record,
      mapping.marketData.availabilityRate,
      "availability rate",
    ),
    askingNetRentPsf: number(
      record,
      mapping.marketData.askingNetRentPsf,
      "asking rent",
    ),
    salesVolume: number(record, mapping.marketData.salesVolume, "sales volume"),
  };
}

export class SalesforceAscendixReportAdapter implements AscendixReportAdapter {
  private readonly client: SalesforceClient;
  private readonly now: () => Date;

  constructor(client: SalesforceClient, now: () => Date = () => new Date()) {
    this.client = client;
    this.now = now;
  }

  async loadReportSource(request: ReportDataRequest) {
    if (request.timeContext.type === "current") {
      throw new Error(
        "Current Salesforce report mapping is not configured yet; use a historical-period request.",
      );
    }
    const market = soqlLiteral(request.market, "market");
    const period = soqlLiteral(request.period, "period");
    const md = mapping.marketData;
    const marketFields = [
      "Id",
      md.market,
      md.period,
      md.submarket,
      ...metricFields,
      md.leasingActivitySf,
      md.narrative,
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
    const lease = mapping.lease;
    const leaseQuery = selectQuery(
      api(lease.object),
      ["Id", lease.tenant, lease.sizeSf, lease.address, lease.type].map(api),
      `${api(lease.market)} = ${market} AND ${api(lease.period)} = ${period}`,
      ` ORDER BY ${api(lease.sizeSf)} DESC LIMIT 20`,
    );
    const sale = mapping.sale;
    const saleQuery = selectQuery(
      api(sale.object),
      ["Id", sale.buyer, sale.price, sale.address, sale.type].map(api),
      `${api(sale.market)} = ${market} AND ${api(sale.period)} = ${period}`,
      ` ORDER BY ${api(sale.price)} DESC LIMIT 20`,
    );
    const availability = mapping.availability;
    const availabilityQuery = selectQuery(
      api(availability.object),
      [
        "Id",
        availability.address,
        availability.sizeSf,
        availability.type,
        availability.sponsor,
        availability.image,
      ].map(api),
      `${api(availability.market)} = ${market} AND ${api(availability.period)} = ${period}`,
      ` ORDER BY ${api(availability.sizeSf)} DESC LIMIT 20`,
    );
    const construction = mapping.construction;
    const constructionQuery = selectQuery(
      api(construction.object),
      [
        "Id",
        construction.address,
        construction.sizeSf,
        construction.type,
        construction.sponsor,
        construction.image,
        construction.status,
      ].map(api),
      `${api(construction.market)} = ${market} AND ${api(construction.period)} = ${period}`,
      ` ORDER BY ${api(construction.sizeSf)} DESC LIMIT 20`,
    );
    const [
      current,
      history,
      leaseRecords,
      saleRecords,
      availabilityRecords,
      constructionRecords,
    ] = await Promise.all([
      this.client.query(currentQuery),
      this.client.query(historyQuery),
      this.client.query(leaseQuery),
      this.client.query(saleQuery),
      this.client.query(availabilityQuery),
      this.client.query(constructionQuery),
    ]);
    if (!current.length)
      throw new Error(
        `No Market_Data__c record exists for ${request.market} / ${request.period}.`,
      );

    const aggregate = current.find((record) => !text(record, md.submarket));
    const submarkets: SubmarketMetrics[] = current
      .filter((record) => text(record, md.submarket))
      .map((record) => ({
        name: text(record, md.submarket),
        ...metrics(record),
      }));
    if (!aggregate && !submarkets.length)
      throw new Error(
        "Historical report data is incomplete: no aggregate or submarket records were returned.",
      );
    const retrievedAt = this.now().toISOString();
    const sourceProvenance: ProvenanceRecord[] = current.flatMap((record) => {
      const scope = text(record, md.submarket) || "overallMarket";
      return metricFields.map((entry) => {
        const key =
          Object.entries(md).find(
            ([, candidate]) => candidate === entry,
          )?.[0] ?? entry.apiName;
        return {
          fieldPath:
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
          authority: `${api(md.object)} historical record`,
          status: "matched" as const,
          critical: ["vacancyRate", "availabilityRate", "inventorySf"].includes(
            key,
          ),
        };
      });
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
    const leasing: LeaseRecord[] = leaseRecords.map((record) => ({
      tenant: requiredText(record, lease.tenant, "lease tenant"),
      sizeSf: number(record, lease.sizeSf, "lease size"),
      address: requiredText(record, lease.address, "lease address"),
      leaseType: requiredText(record, lease.type, "lease type"),
    }));
    const sales: SaleRecord[] = saleRecords.map((record) => ({
      buyer: requiredText(record, sale.buyer, "sale buyer"),
      price: number(record, sale.price, "sale price"),
      address: requiredText(record, sale.address, "sale address"),
      saleType: requiredText(record, sale.type, "sale type"),
    }));
    const mapHighlight = (
      record: SalesforceRecord,
      group: typeof availability | typeof construction,
    ): PropertyHighlight => ({
      address: requiredText(record, group.address, "property address"),
      sizeSf: number(record, group.sizeSf, "property size"),
      type: requiredText(record, group.type, "property type"),
      sponsor: text(record, group.sponsor),
      image: requiredText(record, group.image, "property image"),
    });
    const availabilities = availabilityRecords.map((record) =>
      mapHighlight(record, availability),
    );
    const constructionHighlights = constructionRecords
      .filter(
        (record) =>
          text(record, construction.status).toLowerCase() !== "delivered",
      )
      .map((record) => mapHighlight(record, construction));
    const deliveries = constructionRecords
      .filter(
        (record) =>
          text(record, construction.status).toLowerCase() === "delivered",
      )
      .map((record) => mapHighlight(record, construction));
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
        id: `${request.market.toLowerCase().replace(/\W+/g, "-")}-${request.period.toLowerCase().replace(/\W+/g, "-")}`,
        title: "Industrial Market Report",
        templateId: "industrial-market-report",
        market: request.market,
        period: request.period,
        preparedBy: "Lee & Associates",
      },
      overallMarket: {
        ...(aggregate ? metrics(aggregate) : zero),
        narrative: aggregate ? text(aggregate, md.narrative) : "",
      },
      submarkets,
      historicalPeriods,
      leasing,
      sales,
      availabilities,
      deliveries,
      construction: constructionHighlights,
      provenance: sourceProvenance,
      presentationOverrides: [],
      dataCompleteness: [],
    };
    return {
      report,
      recordCounts: {
        marketData: current.length,
        historicalPeriods: history.length,
        leases: leasing.length,
        sales: sales.length,
        availabilities: availabilities.length,
        construction: constructionRecords.length,
      },
    };
  }

  async health() {
    const status = await this.client.health();
    return { ...status, mode: "salesforce" as const };
  }
}
