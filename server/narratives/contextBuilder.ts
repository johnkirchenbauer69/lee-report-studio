import { createHash } from "node:crypto";
import {
  containsSalesforceIdToken,
} from "../../src/shared/salesforceIds.ts";
import {
  NARRATIVE_PROMPT_PROFILES,
  type NarrativeContext,
  type NarrativeContextCategory,
  type NarrativeContextFact,
  type PublicNarrativeContext,
} from "../../src/report-engine/narratives/schema.ts";
import { OVERALL_MARKET_NARRATIVE_ID } from "../../src/report-engine/narratives/workflow.ts";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import {
  CHICAGO_SUBMARKETS,
  resolveChicagoSubmarket,
} from "../../src/report-engine/submarkets.ts";
import type {
  AbsorptionContributor,
  HistoricalMarketPeriod,
  IndustrialMarketReport,
  LeaseRecord,
  MarketMetrics,
  PropertyHighlight,
  SaleRecord,
} from "../../src/report-engine/schema/industrialMarketReport.ts";

export const NARRATIVE_MATERIALITY = Object.freeze({
  positiveAbsorptionContributors: 5,
  negativeAbsorptionContributors: 5,
  leases: 5,
  sales: 5,
  availabilities: 5,
  construction: 5,
  deliveries: 5,
  leaderboard: 3,
});

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
    .join(",")}}`;
};

export const hashNarrativeContext = (
  context: Omit<NarrativeContext, "contextHash">,
) => createHash("sha256").update(canonicalize(context)).digest("hex");

export const sanitizeNarrativeDataString = (value: unknown, limit = 180) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const sf = (value: number) => {
  const absolute = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (absolute >= 1_000_000)
    return `${sign}${(absolute / 1_000_000).toFixed(1)} million SF`;
  return `${sign}${Math.round(absolute).toLocaleString("en-US")} SF`;
};
const dollars = (value: number) => {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000)
    return `$${(absolute / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(absolute).toLocaleString("en-US")}`;
};
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;
const basisPoints = (value: number) =>
  Math.round(value) === 0
    ? "unchanged"
    : `${value > 0 ? "up" : "down"} ${Math.abs(Math.round(value))} basis points`;
const changePercent = (value: number) =>
  value === 0
    ? "unchanged"
    : `${value > 0 ? "up" : "down"} ${Math.abs(value).toFixed(1)}%`;

const provenanceIds = (report: IndustrialMarketReport, path: string) =>
  report.provenance
    .filter((record) => record.fieldPath === path)
    .flatMap((record) => record.sources.map((source) => source.sourceId));

const fact = (
  input: Omit<NarrativeContextFact, "publicationSafe">,
): NarrativeContextFact => ({ ...input, publicationSafe: true });

const metricFacts = (
  report: IndustrialMarketReport,
  metrics: MarketMetrics,
  history: HistoricalMarketPeriod[],
  prefix: string,
) => {
  const current = history.find((item) => item.period === report.report.period) ?? history[0];
  const previous = history.find((item) => item.period !== current?.period);
  const entries: NarrativeContextFact[] = [];
  const metric = (
    key: string,
    label: string,
    value: number | null,
    displayValue: string,
    path: string,
  ) =>
    entries.push(
      fact({
        contextKey: `metric.${key}.current`,
        category: "metric",
        label,
        value,
        displayValue,
        sourceType: "Market_Data__c",
        authority: "Governed Report Data Service metric",
        internalSourceIds: provenanceIds(report, path),
      }),
    );
  metric("inventory", "Inventory", metrics.inventorySf, sf(metrics.inventorySf).replace(/^\+/, ""), `${prefix}.inventorySf`);
  metric("vacancy", "Vacancy rate", metrics.vacancyRate, percentage(metrics.vacancyRate), `${prefix}.vacancyRate`);
  metric("availability", "Availability rate", metrics.availabilityRate, percentage(metrics.availabilityRate), `${prefix}.availabilityRate`);
  metric("net_absorption", "Quarterly net absorption", metrics.quarterlyNetAbsorptionSf, sf(metrics.quarterlyNetAbsorptionSf), `${prefix}.quarterlyNetAbsorptionSf`);
  metric("asking_rent", "Asking net rent", metrics.askingNetRentPsf, `$${metrics.askingNetRentPsf.toFixed(2)}/SF`, `${prefix}.askingNetRentPsf`);
  metric("under_construction", "Under construction", metrics.underConstructionSf, sf(metrics.underConstructionSf).replace(/^\+/, ""), `${prefix}.underConstructionSf`);
  metric("deliveries", "Quarterly deliveries", metrics.deliveredSf, sf(metrics.deliveredSf).replace(/^\+/, ""), `${prefix}.deliveredSf`);
  metric("speculative_share", "Speculative share", metrics.speculativeShare, percentage(metrics.speculativeShare), `${prefix}.speculativeShare`);
  metric("sales_volume", "Sales volume", metrics.salesVolume, dollars(metrics.salesVolume), `${prefix}.salesVolume`);

  if (current) {
    metric("net_absorption_t12", "Trailing 12-month net absorption", current.trailing12MonthNetAbsorptionSf, current.trailing12MonthNetAbsorptionSf == null ? "Unavailable" : sf(current.trailing12MonthNetAbsorptionSf), `historicalPeriods.${current.period}.trailing12MonthNetAbsorptionSf`);
    metric("leasing_activity", "Quarterly leasing activity", current.leasingActivitySf, sf(current.leasingActivitySf).replace(/^\+/, ""), `historicalPeriods.${current.period}.leasingActivitySf`);
    metric("median_sales_price_psf", "Median sales price", current.medianSalesPricePsf ?? null, current.medianSalesPricePsf == null ? "Unavailable" : `$${current.medianSalesPricePsf.toFixed(2)}/SF`, `historicalPeriods.${current.period}.medianSalesPricePsf`);
  } else {
    metric("net_absorption_t12", "Trailing 12-month net absorption", null, "Unavailable", "historicalPeriods");
    metric("leasing_activity", "Quarterly leasing activity", null, "Unavailable", "historicalPeriods");
    metric("median_sales_price_psf", "Median sales price", null, "Unavailable", "historicalPeriods");
  }

  const delta = (
    key: string,
    label: string,
    value: number | null,
    displayValue: string,
    calculation: string,
  ) =>
    entries.push(
      fact({
        contextKey: `metric.${key}`,
        category: "trend",
        label,
        value,
        displayValue,
        sourceType: "Report_Data_Service",
        authority: "Deterministic application calculation",
        calculation,
        internalSourceIds: [],
      }),
    );
  if (current && previous) {
    delta("vacancy.qoq_bps", "Vacancy QoQ", (current.vacancyRate - previous.vacancyRate) * 10_000, basisPoints((current.vacancyRate - previous.vacancyRate) * 10_000), "(current vacancy rate - previous vacancy rate) × 10,000");
    delta("availability.qoq_bps", "Availability QoQ", (current.availabilityRate - previous.availabilityRate) * 10_000, basisPoints((current.availabilityRate - previous.availabilityRate) * 10_000), "(current availability rate - previous availability rate) × 10,000");
    delta("under_construction.qoq_change_sf", "Under construction QoQ", current.underConstructionSf - previous.underConstructionSf, sf(current.underConstructionSf - previous.underConstructionSf), "current under-construction SF - previous under-construction SF");
    delta("leasing_activity.qoq_change_sf", "Leasing activity QoQ", current.leasingActivitySf - previous.leasingActivitySf, sf(current.leasingActivitySf - previous.leasingActivitySf), "current leasing activity SF - previous leasing activity SF");
    const salesChange = previous.salesVolume && current.salesVolume != null
      ? ((current.salesVolume - previous.salesVolume) / previous.salesVolume) * 100
      : null;
    delta("sales_volume.qoq_percent", "Sales volume QoQ", salesChange, salesChange == null ? "Unavailable" : changePercent(salesChange), "((current sales volume - previous sales volume) / previous sales volume) × 100");
  }
  history.slice(0, 5).forEach((item, index) =>
    entries.push(
      fact({
        contextKey: `trend.period.${index + 1}`,
        category: "trend",
        label: item.period,
        value: item.period,
        displayValue: `${item.period}: vacancy ${percentage(item.vacancyRate)}, availability ${percentage(item.availabilityRate)}, absorption ${sf(item.quarterlyNetAbsorptionSf)}`,
        sourceType: "Market_Data__c",
        authority: "Governed five-quarter Market_Data history",
        internalSourceIds: provenanceIds(report, `historicalPeriods.${item.period}`),
      }),
    ),
  );
  return entries;
};

const safeText = (value: unknown) => {
  const output = sanitizeNarrativeDataString(value);
  return containsSalesforceIdToken(output) ? "" : output;
};

const transactionFacts = (
  report: IndustrialMarketReport,
  records: {
    leases: LeaseRecord[];
    sales: SaleRecord[];
    availabilities: PropertyHighlight[];
    construction: PropertyHighlight[];
    deliveries: PropertyHighlight[];
  },
  provenancePrefix = "",
) => {
  const facts: NarrativeContextFact[] = [];
  [...records.leases]
    .filter((lease) => lease.isDealConfidential === false)
    .sort((a, b) => b.sizeSf - a.sizeSf)
    .slice(0, NARRATIVE_MATERIALITY.leases)
    .forEach((lease, index) => {
      const tenant = safeText(lease.tenantDisplayName ?? lease.tenant);
      const address = safeText(lease.address);
      facts.push(fact({
        contextKey: `lease.${index + 1}`,
        category: "lease",
        label: tenant || "Published tenant unavailable",
        value: lease.sizeSf,
        displayValue: [tenant, sf(lease.sizeSf).replace(/^\+/, ""), address, safeText(lease.leaseType)].filter(Boolean).join(" · "),
        sourceType: "Market_Data_Contributor__c",
        authority: "Quarter-scoped publication-safe contributor finalist",
        internalSourceIds: provenanceIds(report, `${provenancePrefix}leasing.${index}`),
        entityNames: [tenant, address].filter(Boolean),
      }));
    });
  [...records.sales]
    .sort((a, b) => b.price - a.price)
    .slice(0, NARRATIVE_MATERIALITY.sales)
    .forEach((sale, index) => {
      const buyer = safeText(sale.buyer);
      const address = safeText(sale.address);
      facts.push(fact({
        contextKey: `sale.${index + 1}`,
        category: "sale",
        label: buyer || "Published buyer unavailable",
        value: sale.price,
        displayValue: [buyer, dollars(sale.price), address, safeText(sale.saleType)].filter(Boolean).join(" · "),
        sourceType: "Market_Data_Contributor__c",
        authority: "Quarter-scoped publication-safe contributor finalist",
        internalSourceIds: provenanceIds(report, `${provenancePrefix}sales.${index}`),
        entityNames: [buyer, address].filter(Boolean),
      }));
    });
  const addProperties = (
    category: "availability" | "construction" | "delivery",
    items: PropertyHighlight[],
    limit: number,
  ) =>
    [...items]
      .sort((a, b) => b.sizeSf - a.sizeSf)
      .slice(0, limit)
      .forEach((item, index) => {
        const address = safeText(item.address);
        const developer = safeText(item.developer || item.sponsor);
        facts.push(fact({
          contextKey: `${category}.${index + 1}`,
          category,
          label: address || `${category} ${index + 1}`,
          value: item.sizeSf,
          displayValue: [address, sf(item.sizeSf).replace(/^\+/, ""), safeText(item.type), developer].filter(Boolean).join(" · "),
          sourceType: category === "availability" ? "Property_Data__c" : "Market_Data_Contributor__c",
          authority: `Quarter-scoped ${category} finalist`,
          internalSourceIds: provenanceIds(report, `${provenancePrefix}${category === "delivery" ? "deliveries" : `${category}s`}.${index}`),
          entityNames: [address, developer].filter(Boolean),
        }));
      });
  addProperties("availability", records.availabilities, NARRATIVE_MATERIALITY.availabilities);
  addProperties("construction", records.construction, NARRATIVE_MATERIALITY.construction);
  addProperties("delivery", records.deliveries, NARRATIVE_MATERIALITY.deliveries);
  return facts;
};

const rankingFacts = (report: IndustrialMarketReport) => {
  const facts: NarrativeContextFact[] = [];
  const rank = (
    metric: keyof MarketMetrics,
    label: string,
    formatter: (value: number) => string,
  ) => {
    const ordered = [...report.submarkets].sort(
      (a, b) => Number(b[metric]) - Number(a[metric]),
    );
    const sets = [
      ["leader", ordered.slice(0, NARRATIVE_MATERIALITY.leaderboard)],
      ["laggard", ordered.slice(-NARRATIVE_MATERIALITY.leaderboard).reverse()],
    ] as const;
    sets.forEach(([direction, rows]) =>
      rows.forEach((row, index) =>
        facts.push(fact({
          contextKey: `submarket_rank.${String(metric)}.${direction}.${index + 1}`,
          category: "ranking",
          label: `${label} ${direction}`,
          value: Number(row[metric]),
          displayValue: `${safeText(row.name)} · ${formatter(Number(row[metric]))}`,
          sourceType: "Market_Data__c",
          authority: "Deterministic ranking of the 18 canonical submarkets",
          calculation: `Sort canonical submarkets by ${String(metric)} ${direction === "leader" ? "descending" : "ascending"}`,
          internalSourceIds: provenanceIds(report, `submarkets.${row.name}.${String(metric)}`),
          entityNames: [safeText(row.name)],
        })),
      ),
    );
  };
  rank("quarterlyNetAbsorptionSf", "Quarterly absorption", sf);
  rank("vacancyRate", "Vacancy", percentage);
  rank("availabilityRate", "Availability", percentage);
  rank("underConstructionSf", "Under construction", (value) => sf(value).replace(/^\+/, ""));
  return facts;
};

const absorptionDriverFacts = (
  report: IndustrialMarketReport,
  marketId: string,
  direct: AbsorptionContributor[],
  provenancePrefix = "",
) => {
  const overall = marketId === OVERALL_MARKET_NARRATIVE_ID;
  const identity = overall ? undefined : resolveChicagoSubmarket(marketId);
  if (direct.length)
    return (["positive", "negative"] as const).flatMap((direction) =>
      direct
        .filter((item) => item.direction === direction)
        .sort((left, right) => Math.abs(right.contributionSf) - Math.abs(left.contributionSf))
        .slice(
          0,
          direction === "positive"
            ? NARRATIVE_MATERIALITY.positiveAbsorptionContributors
            : NARRATIVE_MATERIALITY.negativeAbsorptionContributors,
        )
        .map((item, index) => {
          const name = safeText(item.propertyName);
          const address = safeText(item.address);
          return fact({
            contextKey: `driver.absorption.${direction}.${index + 1}`,
            category: "driver" as const,
            label: name,
            value: item.contributionSf,
            displayValue: [name, address, sf(item.contributionSf)].filter(Boolean).join(" · "),
            sourceType: "Market_Data_Contributor__c" as const,
            authority: "Quarter-scoped absorption contributor ranking",
            internalSourceIds: provenanceIds(
              report,
              `${provenancePrefix}absorptionContributors.${index}`,
            ),
            entityNames: [name, address].filter(Boolean),
          });
        }),
    );
  const candidates = report.provenance
    .map((record) => ({
      record,
      value:
        record.selectedValue && typeof record.selectedValue === "object"
          ? (record.selectedValue as Record<string, unknown>)
          : undefined,
    }))
    .filter(({ value }) => {
      if (!value) return false;
      const category = safeText(value.category ?? value.contributorCategory)
        .toLocaleLowerCase();
      if (!category.includes("absorption")) return false;
      if (overall) return true;
      return (
        resolveChicagoSubmarket(safeText(value.submarket))?.id === identity?.id
      );
    });
  const build = (direction: "positive" | "negative") =>
    candidates
      .filter(({ value }) =>
        safeText(value!.category ?? value!.contributorCategory)
          .toLocaleLowerCase()
          .includes(direction),
      )
      .sort(
        (left, right) =>
          Math.abs(Number(right.value!.sortValue ?? right.value!.metricValue ?? 0)) -
          Math.abs(Number(left.value!.sortValue ?? left.value!.metricValue ?? 0)),
      )
      .slice(
        0,
        direction === "positive"
          ? NARRATIVE_MATERIALITY.positiveAbsorptionContributors
          : NARRATIVE_MATERIALITY.negativeAbsorptionContributors,
      )
      .map(({ record, value }, index) => {
        const contribution = Number(value!.metricValue ?? value!.sortValue ?? 0);
        const name =
          safeText(value!.sourceRecordName ?? value!.propertyName) ||
          "Property contributor";
        return fact({
          contextKey: `driver.absorption.${direction}.${index + 1}`,
          category: "driver" as const,
          label: name,
          value: contribution,
          displayValue: `${name} · ${sf(contribution)}`,
          sourceType: "Market_Data_Contributor__c" as const,
          authority: "Quarter-scoped absorption contributor ranking",
          internalSourceIds: record.sources.map((source) => source.sourceId),
          entityNames: [name],
        });
      });
  return [...build("positive"), ...build("negative")];
};

export function buildNarrativeContext(input: {
  reportInstance: ReportInstance;
  marketId: string;
}): NarrativeContext {
  const { reportInstance, marketId } = input;
  const report = reportInstance.dataSnapshot;
  const overall = marketId === OVERALL_MARKET_NARRATIVE_ID;
  const identity = overall ? undefined : resolveChicagoSubmarket(marketId);
  if (!overall && !identity) throw new Error(`Unknown narrative market ${marketId}.`);
  const detail = overall
    ? undefined
    : report.submarketDetails.find(
        (item) => resolveChicagoSubmarket(item.id ?? item.name)?.id === identity!.id,
      );
  const metricRow = overall
    ? report.overallMarket
    : detail?.metrics ??
      report.submarkets.find(
        (item) => resolveChicagoSubmarket(item.id ?? item.name)?.id === identity!.id,
      );
  if (!metricRow) throw new Error(`${identity!.displayName} metrics are unavailable.`);
  const history = overall ? report.historicalPeriods : (detail?.historicalPeriods ?? []);
  const marketName = overall ? "Overall Market" : identity!.displayName;
  const prefix = overall ? "overallMarket" : `submarkets.${identity!.canonicalName}`;
  const facts = [
    ...metricFacts(report, metricRow, history, prefix),
    ...(overall ? rankingFacts(report) : []),
    ...absorptionDriverFacts(
      report,
      marketId,
      overall
        ? report.absorptionContributors
        : (detail?.absorptionContributors ?? []),
      overall ? "" : `submarketDetails.${identity!.canonicalName}.`,
    ),
    ...transactionFacts(
      report,
      overall
        ? {
            leases: report.leasing,
            sales: report.sales,
            availabilities: report.availabilities,
            construction: report.construction,
            deliveries: report.deliveries,
          }
        : {
            leases: detail?.leasing ?? [],
            sales: detail?.sales ?? [],
            availabilities: detail?.availabilities ?? [],
            construction: detail?.construction ?? [],
            deliveries: detail?.deliveries ?? [],
          },
      overall ? "" : `submarketDetails.${identity!.canonicalName}.`,
    ),
  ];
  const base: Omit<NarrativeContext, "contextHash"> = {
    marketId,
    marketName,
    marketKind: overall ? "overall" : "submarket",
    period: report.report.period,
    promptVersion:
      NARRATIVE_PROMPT_PROFILES[overall ? "overall" : "submarket"].version,
    facts,
  };
  return { ...base, contextHash: hashNarrativeContext(base) };
}

export function publicNarrativeContext(
  context: NarrativeContext,
): PublicNarrativeContext {
  const output = {
    ...context,
    facts: context.facts.map(({ internalSourceIds: _ids, ...item }) => item),
  };
  const inspect = (value: unknown, path = "narrative context") => {
    if (typeof value === "string" && containsSalesforceIdToken(value))
      throw new Error(`Unsafe Salesforce record id in client-facing ${path}.`);
    if (Array.isArray(value)) value.forEach((item, index) => inspect(item, `${path}[${index}]`));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([key, item]) => inspect(item, `${path}.${key}`));
  };
  inspect(output);
  return output;
}
