import {
  brokerContextForMarket,
  narrativeV2BrokerContextSchema,
} from "../../src/report-engine/narratives/brokerInterviews.ts";
import { createHash } from "node:crypto";
import { NARRATIVE_PUBLICATION_STYLE } from "../../src/report-engine/narratives/publicationStyle.ts";
import {
  containsSalesforceIdToken,
} from "../../src/shared/salesforceIds.ts";
import { sanitizePublicationEntity } from "../../src/shared/publicationEntitySafety.ts";
import {
  NARRATIVE_CONTEXT_MODEL_VERSION,
  NARRATIVE_EXPLANATORY_TYPES,
  NARRATIVE_OUTPUT_CONTRACT_VERSION,
  NARRATIVE_PROMPT_PROFILES,
  NARRATIVE_TRANSPORT_PROMPT_PROFILES,
  transportPromptVersion,
  type NarrativeAnalyticalType,
  type NarrativeCausalCoverage,
  type NarrativeContext,
  type NarrativeContextFact,
  type NarrativeEditorialBrief,
  type NarrativeEvidenceStrength,
  type NarrativePageComponent,
  type NarrativePageContext,
  type PublicNarrativeContext,
} from "../../src/report-engine/narratives/schema.ts";
import { OVERALL_MARKET_NARRATIVE_ID } from "../../src/report-engine/narratives/workflow.ts";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import { resolveChicagoSubmarket } from "../../src/report-engine/submarkets.ts";
import { resolvePresentationValue } from "../../src/report-engine/provenance/provenance.ts";
import type {
  AbsorptionContributor,
  GovernedExplanatoryFact,
  HistoricalMarketPeriod,
  IndustrialMarketReport,
  LeaseRecord,
  MarketMetrics,
  OverallMarketMetrics,
  PropertyHighlight,
  SaleRecord,
} from "../../src/report-engine/schema/industrialMarketReport.ts";

/**
 * Deterministic caps applied before inference. Transactions are no longer a
 * plain top-N: leases and sales must also pass the materiality rule in
 * transactionMateriality, and these are the maxima after that rule.
 */
export const NARRATIVE_MATERIALITY = Object.freeze({
  positiveAbsorptionContributors: 5,
  negativeAbsorptionContributors: 5,
  overallLeases: 4,
  submarketLeases: 3,
  overallSales: 4,
  submarketSales: 3,
  availabilities: 3,
  construction: 3,
  deliveries: 3,
  leaderboard: 3,
  /** Rows the Top Leases / Top Sales / property-card components display. */
  visibleTableRows: 3,
});

/**
 * Transaction materiality thresholds. A transaction reaches narrative
 * context only when it is linked to a governed driver or scores at least
 * MIN_SCORE across rank, absolute size, and share of the quarter's total.
 */
export const TRANSACTION_MATERIALITY = Object.freeze({
  minScore: 3,
  leaseLargeSf: 500_000,
  leaseMediumSf: 250_000,
  saleLargeUsd: 100_000_000,
  saleMediumUsd: 40_000_000,
  majorShare: 0.25,
  notableShare: 0.1,
});

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
    .join(",")}}`;
};

export const hashNarrativeContext = (
  context: Omit<NarrativeContext, "contextHash">,
) => createHash("sha256").update(canonicalize(context)).digest("hex");

const NARRATIVE_BINDING_PATHS = new Set([
  "overallMarket.narrative",
  "market.narrative",
]);

/**
 * Fingerprint of the exact report data a narrative is written and reviewed
 * against. Covers the provider snapshot hash, the full data snapshot with
 * narrative prose blanked (prose is the narrative itself, not its input),
 * and every data-bearing manual override, because an override changes what
 * the reader sees next to the narrative even though the governed snapshot
 * is untouched. Overrides of narrative text are excluded here and handled
 * as a readiness blocker instead (see narrativeSnapshotIssues).
 */
export function narrativeReportDataFingerprint(instance: ReportInstance) {
  const snapshot = structuredClone(instance.dataSnapshot);
  snapshot.overallMarket.narrative = "";
  snapshot.submarketDetails.forEach((detail) => {
    detail.narrative = "";
  });
  const overrides = (instance.manualOverrides ?? [])
    .filter((item) => !item.cellKey && !NARRATIVE_BINDING_PATHS.has(item.bindingPath ?? ""))
    .map((item) => ({
      elementId: item.elementId,
      bindingPath: item.bindingPath ?? null,
      overrideValue: item.overrideValue ?? null,
    }))
    .sort((left, right) =>
      `${left.elementId}:${left.bindingPath}`.localeCompare(
        `${right.elementId}:${right.bindingPath}`,
      ),
    );
  return createHash("sha256")
    .update(
      canonicalize({
        sourceSnapshotHash: instance.sourceSnapshotHash ?? null,
        dataSnapshot: snapshot,
        manualOverrides: overrides,
      }),
    )
    .digest("hex");
}

export const sanitizeNarrativeDataString = (value: unknown, limit = 180) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

// --- Display formatting ---------------------------------------------------
// The model must never recalculate: every value it may cite arrives here as
// a publication-ready display string.

const sf = (value: number) => {
  const absolute = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (absolute >= 1_000_000)
    return `${sign}${(absolute / 1_000_000).toFixed(1)} million SF`;
  return `${sign}${Math.round(absolute).toLocaleString("en-US")} SF`;
};
const unsignedSf = (value: number) => sf(value).replace(/^\+/, "");

/**
 * Currency display: ≥ $1B as "$1.19 billion", $1M–$999.9M as
 * "$218.4 million", below that as whole dollars. A value that would round
 * to "$1000.0 million" is promoted to billions.
 */
export const formatNarrativeCurrency = (value: number) => {
  const absolute = Math.abs(value);
  if (absolute >= 999_950_000)
    return `$${(absolute / 1_000_000_000).toFixed(2)} billion`;
  if (absolute >= 1_000_000)
    return `$${(absolute / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(absolute).toLocaleString("en-US")}`;
};
const dollars = formatNarrativeCurrency;
/** Asking rent always carries the currency symbol: "$8.18/SF". */
export const formatAskingRent = (value: number) => `$${value.toFixed(2)}/SF`;
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;
const basisPoints = (value: number) =>
  Math.round(value) === 0
    ? "unchanged"
    : `${value > 0 ? "up" : "down"} ${Math.abs(Math.round(value))} basis points`;
const changePercent = (value: number) =>
  value === 0
    ? "unchanged"
    : `${value > 0 ? "up" : "down"} ${Math.abs(value).toFixed(1)}%`;
const share = (value: number) => `${(value * 100).toFixed(1)}%`;

const provenanceIds = (report: IndustrialMarketReport, path: string) =>
  report.provenance
    .filter((record) => record.fieldPath === path)
    .flatMap((record) => record.sources.map((source) => source.sourceId));

const fact = (
  input: Omit<NarrativeContextFact, "publicationSafe">,
): NarrativeContextFact => ({ ...input, publicationSafe: true });

const safeText = (value: unknown, limit = 180) => {
  const output = sanitizeNarrativeDataString(value, limit);
  if (containsSalesforceIdToken(output)) return "";
  return sanitizePublicationEntity(output);
};

/**
 * Governed enum-like values (driver type, construction type, timing):
 * markup/identifier-safe, but never entity-sanitized, because entity
 * sanitization blanks placeholder words such as "Unknown" that are
 * meaningful governed values here.
 */
const safeToken = (value: unknown, limit = 60) => {
  const output = sanitizeNarrativeDataString(value, limit);
  return containsSalesforceIdToken(output) ? "" : output;
};

/** Governed explanatory display strings: sanitized but not entity-trimmed. */
const safeSentence = (value: unknown) => {
  const output = sanitizeNarrativeDataString(value, 280);
  return containsSalesforceIdToken(output) ? "" : output;
};

/** Parses a "YYYY Qn" governed period label. Returns null for anything else. */
const parsePeriod = (period: string): { year: number; quarter: number } | null => {
  const match = /^(\d{4})\s*Q([1-4])$/.exec(period.trim());
  if (!match) return null;
  return { year: Number(match[1]), quarter: Number(match[2]) };
};
const periodOrdinal = (period: string) => {
  const parsed = parsePeriod(period);
  return parsed ? parsed.year * 4 + parsed.quarter : null;
};

const normalizedEntity = (value: string) =>
  value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// --- Page awareness -------------------------------------------------------

const elementPaths = (element: unknown): string[] => {
  const candidate = element as {
    sourcePath?: string;
    binding?: { path?: string };
    bindingContext?: { path?: string };
    type?: string;
  };
  return [
    candidate.sourcePath,
    candidate.binding?.path,
    candidate.bindingContext?.path,
  ].filter((path): path is string => typeof path === "string");
};

/**
 * Derives what the reader already sees from the generated report pages.
 * Each market's pages carry its geographyId ("overall-market" for the
 * Overall pages); overall-scope pages with no geography (the market-wide
 * submarket table) also count for the Overall Market. Falls back to the
 * standard report layout when the instance has no pages for the market.
 */
export function narrativePageContext(
  instance: Pick<ReportInstance, "pages">,
  marketId: string,
): NarrativePageContext {
  const overall = marketId === OVERALL_MARKET_NARRATIVE_ID;
  const pages = (instance.pages ?? []).filter(
    (page) =>
      page.geographyId === marketId ||
      (overall && !page.geographyId && !page.bindingContext),
  );
  if (!pages.length)
    return {
      marketIndicatorsVisible: true,
      trendChartsVisible: true,
      submarketTableVisible: overall,
      topLeasesVisible: true,
      topSalesVisible: true,
      propertyCardsVisible: true,
      detailedSupplyPageFollows: true,
    };
  const narrativePath = overall ? "overallMarket.narrative" : "market.narrative";
  const pageHas = (
    page: (typeof pages)[number],
    test: (path: string, element: unknown) => boolean,
  ) =>
    page.elements.some(
      (element) =>
        !element.hidden &&
        elementPaths(element).some((path) => test(path, element)),
    );
  const anyPage = (test: (path: string, element: unknown) => boolean) =>
    pages.some((page) => pageHas(page, test));
  const isCard = (path: string) =>
    /top(Construction|Deliveries|Availabilities)/i.test(path) ||
    path.endsWith("availabilityBySize");
  const narrativePages = pages.filter((page) =>
    pageHas(page, (path) => path === narrativePath),
  );
  return {
    marketIndicatorsVisible: anyPage((path) => path.endsWith("indicatorRows")),
    trendChartsVisible: anyPage(
      (path, element) =>
        (element as { type?: string }).type === "chart" &&
        path.endsWith("historicalPeriods"),
    ),
    submarketTableVisible: anyPage((path) => path.endsWith("submarketTableRows")),
    topLeasesVisible: anyPage((path) => path.endsWith("topLeaseRows")),
    topSalesVisible: anyPage((path) => path.endsWith("topSaleRows")),
    propertyCardsVisible: anyPage(isCard),
    detailedSupplyPageFollows: pages.some(
      (page) => !narrativePages.includes(page) && pageHas(page, isCard),
    ),
  };
}

// --- Current metrics, deltas, YoY, YTD -----------------------------------

const metricFacts = (
  report: IndustrialMarketReport,
  // Overall Market rent may be an authoritative null; optionalMetric
  // already reports a null as "Unavailable".
  metrics: MarketMetrics | OverallMarketMetrics,
  history: HistoricalMarketPeriod[],
  prefix: string,
  options: { overall: boolean; pageContext: NarrativePageContext },
) => {
  const current = history.find((item) => item.period === report.report.period) ?? history[0];
  const previous = history.find((item) => item.period !== current?.period);
  const entries: NarrativeContextFact[] = [];
  const indicators: NarrativePageComponent[] = options.pageContext.marketIndicatorsVisible ? ["market_indicators"] : [];
  const charts: NarrativePageComponent[] = options.pageContext.trendChartsVisible ? ["trend_charts"] : [];
  const table: NarrativePageComponent[] = options.pageContext.submarketTableVisible ? ["submarket_table"] : [];
  const metric = (
    key: string,
    label: string,
    value: number | null,
    displayValue: string,
    path: string,
    extra: Partial<NarrativeContextFact> = {},
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
        analyticalType: "metric",
        editorialPriority: "supporting",
        ...extra,
      }),
    );
  // Every headline value resolves exactly as the report page resolves it
  // (explicit presentation overrides included), so prose and tables agree.
  const optionalMetric = (
    key: string,
    label: string,
    field: keyof MarketMetrics,
    formatter: (available: number) => string,
    visibleOn: NarrativePageComponent[],
    extra: Partial<NarrativeContextFact> = {},
    valueOverride?: number,
  ) => {
    const path = `${prefix}.${String(field)}`;
    const raw =
      valueOverride ?? resolvePresentationValue(report, path, metrics[field]);
    const available = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    metric(key, label, available, available === null ? "Unavailable" : formatter(available), path, {
      visibleOn,
      ...extra,
    });
  };
  optionalMetric("inventory", "Inventory", "inventorySf", unsignedSf, table, { editorialPriority: "background" });
  optionalMetric("vacancy", "Vacancy rate", "vacancyRate", percentage, [...indicators, ...charts, ...table]);
  optionalMetric("availability", "Availability rate", "availabilityRate", percentage, [...indicators, ...charts, ...table]);
  optionalMetric("net_absorption", "Quarterly net absorption", "quarterlyNetAbsorptionSf", sf, [...charts, ...table]);
  optionalMetric("asking_rent", "Asking net rent", "askingNetRentPsf", formatAskingRent, table);
  optionalMetric("under_construction", "Under construction", "underConstructionSf", unsignedSf, [...indicators, ...table]);
  optionalMetric("deliveries", "Quarterly deliveries", "deliveredSf", unsignedSf, table);
  optionalMetric("speculative_share", "Speculative share", "speculativeShare", percentage, table, { editorialPriority: "background" });
  if (options.overall) {
    // The Overall page's Market Totals row renders report.overallMarket
    // (for full Chicago scope, the first-class Overall Market Market_Data__c
    // row). The narrative cites that same authoritative figure.
    optionalMetric("sales_volume", "Sales volume", "salesVolume", dollars, [...table], {
      calculation: "Market Totals row: report.overallMarket.salesVolume (first-class Overall Market row)",
    });
  } else
    optionalMetric("sales_volume", "Sales volume", "salesVolume", dollars, table);

  if (current) {
    metric("net_absorption_t12", "Trailing 12-month net absorption", current.trailing12MonthNetAbsorptionSf, current.trailing12MonthNetAbsorptionSf == null ? "Unavailable" : sf(current.trailing12MonthNetAbsorptionSf), `historicalPeriods.${current.period}.trailing12MonthNetAbsorptionSf`, { visibleOn: indicators });
    metric("leasing_activity", "Quarterly leasing activity", current.leasingActivitySf, current.leasingActivitySf == null ? "Unavailable" : unsignedSf(current.leasingActivitySf), `historicalPeriods.${current.period}.leasingActivitySf`, { visibleOn: indicators });
    metric("median_sales_price_psf", "Median sales price", current.medianSalesPricePsf ?? null, current.medianSalesPricePsf == null ? "Unavailable" : `$${current.medianSalesPricePsf.toFixed(2)}/SF`, `historicalPeriods.${current.period}.medianSalesPricePsf`, { visibleOn: charts, editorialPriority: "background" });
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
    extra: Partial<NarrativeContextFact> = {},
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
        analyticalType: "trend",
        editorialPriority: "supporting",
        ...extra,
      }),
    );
  if (current && previous) {
    // Every comparison is omitted when either side is an authoritative null.
    const vacancyChange =
      current.vacancyRate != null && previous.vacancyRate != null
        ? (current.vacancyRate - previous.vacancyRate) * 10_000
        : null;
    const availabilityChange =
      current.availabilityRate != null && previous.availabilityRate != null
        ? (current.availabilityRate - previous.availabilityRate) * 10_000
        : null;
    if (vacancyChange != null)
      delta("vacancy.qoq_bps", "Vacancy QoQ", vacancyChange, basisPoints(vacancyChange), "(current vacancy rate - previous vacancy rate) × 10,000", { priorValue: previous.vacancyRate, currentValue: current.vacancyRate, changeValue: vacancyChange, visibleOn: indicators });
    if (availabilityChange != null)
      delta("availability.qoq_bps", "Availability QoQ", availabilityChange, basisPoints(availabilityChange), "(current availability rate - previous availability rate) × 10,000", { priorValue: previous.availabilityRate, currentValue: current.availabilityRate, changeValue: availabilityChange, visibleOn: indicators });
    if (current.underConstructionSf != null && previous.underConstructionSf != null)
      delta("under_construction.qoq_change_sf", "Under construction QoQ", current.underConstructionSf - previous.underConstructionSf, sf(current.underConstructionSf - previous.underConstructionSf), "current under-construction SF - previous under-construction SF", { priorValue: previous.underConstructionSf, currentValue: current.underConstructionSf, changeValue: current.underConstructionSf - previous.underConstructionSf });
    const leasingBoth = current.leasingActivitySf != null && previous.leasingActivitySf != null;
    if (leasingBoth)
      delta("leasing_activity.qoq_change_sf", "Leasing activity QoQ", current.leasingActivitySf! - previous.leasingActivitySf!, sf(current.leasingActivitySf! - previous.leasingActivitySf!), "current leasing activity SF - previous leasing activity SF", { priorValue: previous.leasingActivitySf, currentValue: current.leasingActivitySf, changeValue: current.leasingActivitySf! - previous.leasingActivitySf! });
    const leasingActivityChange = leasingBoth && previous.leasingActivitySf
      ? ((current.leasingActivitySf! - previous.leasingActivitySf) / previous.leasingActivitySf) * 100
      : null;
    delta("leasing_activity.qoq_percent", "Leasing activity QoQ %", leasingActivityChange, leasingActivityChange == null ? "Unavailable" : changePercent(leasingActivityChange), "((current leasing activity SF - previous leasing activity SF) / previous leasing activity SF) × 100");
    const absorptionBoth = current.quarterlyNetAbsorptionSf != null && previous.quarterlyNetAbsorptionSf != null;
    if (absorptionBoth)
      delta("net_absorption.qoq_change_sf", "Net absorption QoQ", current.quarterlyNetAbsorptionSf! - previous.quarterlyNetAbsorptionSf!, sf(current.quarterlyNetAbsorptionSf! - previous.quarterlyNetAbsorptionSf!), "current quarterly net absorption SF - previous quarterly net absorption SF", { priorValue: previous.quarterlyNetAbsorptionSf, currentValue: current.quarterlyNetAbsorptionSf, changeValue: current.quarterlyNetAbsorptionSf! - previous.quarterlyNetAbsorptionSf! });
    const absorptionChange = absorptionBoth && previous.quarterlyNetAbsorptionSf
      ? ((current.quarterlyNetAbsorptionSf! - previous.quarterlyNetAbsorptionSf) / Math.abs(previous.quarterlyNetAbsorptionSf)) * 100
      : null;
    delta("net_absorption.qoq_percent", "Net absorption QoQ %", absorptionChange, absorptionChange == null ? "Unavailable" : changePercent(absorptionChange), "((current net absorption - previous net absorption) / |previous net absorption|) × 100");
    const salesChange = previous.salesVolume && current.salesVolume != null
      ? ((current.salesVolume - previous.salesVolume) / previous.salesVolume) * 100
      : null;
    delta("sales_volume.qoq_percent", "Sales volume QoQ", salesChange, salesChange == null ? "Unavailable" : changePercent(salesChange), "((current sales volume - previous sales volume) / previous sales volume) × 100");

    // Deterministic juxtaposition, not causation: vacancy moving against
    // the sign of net absorption is an analytically meaningful divergence
    // the prose may state ("despite"), but never explain without a
    // governed vacancy driver.
    const vacancyRose = vacancyChange != null && vacancyChange >= 1;
    const vacancyFell = vacancyChange != null && vacancyChange <= -1;
    const absorption = current.quarterlyNetAbsorptionSf;
    if (
      vacancyChange != null &&
      current.vacancyRate != null &&
      absorption != null &&
      ((vacancyRose && absorption > 0) || (vacancyFell && absorption < 0))
    )
      delta(
        "vacancy_vs_absorption.divergence",
        "Vacancy moved against net absorption",
        vacancyChange,
        `Vacancy ${vacancyRose ? "rose" : "fell"} ${Math.abs(Math.round(vacancyChange))} basis points to ${percentage(current.vacancyRate)} despite ${absorption > 0 ? "positive" : "negative"} quarterly net absorption of ${sf(absorption)}`,
        "Sign of vacancy QoQ change compared with the sign of quarterly net absorption",
        { causalSupport: false, editorialPriority: "lead" },
      );
  }

  entries.push(...yoyFacts(current, history));
  entries.push(...ytdFacts(history));
  entries.push(...historicalContextFacts(history));
  entries.push(...inflectionFacts(history));
  history.slice(0, 5).forEach((item, index) =>
    entries.push(
      fact({
        contextKey: `trend.period.${index + 1}`,
        category: "trend",
        label: item.period,
        value: item.period,
        displayValue: `${item.period}: vacancy ${item.vacancyRate == null ? "unavailable" : percentage(item.vacancyRate)}, availability ${item.availabilityRate == null ? "unavailable" : percentage(item.availabilityRate)}, absorption ${item.quarterlyNetAbsorptionSf == null ? "unavailable" : sf(item.quarterlyNetAbsorptionSf)}`,
        sourceType: "Market_Data__c",
        authority: "Governed five-quarter Market_Data history",
        internalSourceIds: provenanceIds(report, `historicalPeriods.${item.period}`),
        analyticalType: "trend",
        editorialPriority: "background",
        visibleOn: [...charts, ...indicators],
      }),
    ),
  );
  return entries;
};

/** current is the parsed current-quarter row; unavailable if history omits it. */
const yoyFacts = (
  current: HistoricalMarketPeriod | undefined,
  history: HistoricalMarketPeriod[],
): NarrativeContextFact[] => {
  if (!current) return [];
  const currentPeriod = parsePeriod(current.period);
  if (!currentPeriod) return [];
  const priorYear = history.find((item) => {
    const parsed = parsePeriod(item.period);
    return (
      parsed &&
      parsed.quarter === currentPeriod.quarter &&
      parsed.year === currentPeriod.year - 1
    );
  });
  if (!priorYear) return [];
  const entries: NarrativeContextFact[] = [];
  const yoy = (
    key: string,
    label: string,
    value: number,
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
        authority: "Deterministic application calculation vs. same quarter one year prior",
        calculation,
        internalSourceIds: [],
        analyticalType: "trend",
        editorialPriority: "supporting",
      }),
    );
  // Authoritative nulls on either quarter omit that YoY fact entirely.
  const change = (a: number | null, b: number | null) =>
    a != null && b != null ? a - b : null;
  const vacancyYoy = change(current.vacancyRate, priorYear.vacancyRate);
  if (vacancyYoy != null)
    yoy("vacancy.yoy_bps", "Vacancy YoY", vacancyYoy * 10_000, basisPoints(vacancyYoy * 10_000), `(vacancy ${current.period} - vacancy ${priorYear.period}) × 10,000`);
  const availabilityYoy = change(current.availabilityRate, priorYear.availabilityRate);
  if (availabilityYoy != null)
    yoy("availability.yoy_bps", "Availability YoY", availabilityYoy * 10_000, basisPoints(availabilityYoy * 10_000), `(availability ${current.period} - availability ${priorYear.period}) × 10,000`);
  const absorptionYoy = change(current.quarterlyNetAbsorptionSf, priorYear.quarterlyNetAbsorptionSf);
  if (absorptionYoy != null)
    yoy("net_absorption.yoy_change_sf", "Net absorption YoY", absorptionYoy, sf(absorptionYoy), `net absorption ${current.period} - net absorption ${priorYear.period}`);
  const leasingYoy = change(current.leasingActivitySf, priorYear.leasingActivitySf);
  if (leasingYoy != null)
    yoy("leasing_activity.yoy_change_sf", "Leasing activity YoY", leasingYoy, sf(leasingYoy), `leasing activity ${current.period} - leasing activity ${priorYear.period}`);
  const constructionYoy = change(current.underConstructionSf, priorYear.underConstructionSf);
  if (constructionYoy != null)
    yoy("under_construction.yoy_change_sf", "Under construction YoY", constructionYoy, sf(constructionYoy), `under construction ${current.period} - under construction ${priorYear.period}`);
  if (current.deliveredSf != null && priorYear.deliveredSf != null)
    yoy("deliveries.yoy_change_sf", "Deliveries YoY", current.deliveredSf - priorYear.deliveredSf, sf(current.deliveredSf - priorYear.deliveredSf), `deliveries ${current.period} - deliveries ${priorYear.period}`);
  // Asking rent has no historical series in the governed schema; a YoY figure
  // cannot be calculated without fabricating a value, so it is omitted.
  return entries;
};

/**
 * Sums the governed quarters from Q1 through the current quarter of the
 * current year. Omitted entirely (per metric) unless every intervening
 * quarter is present in history — a partial sum would misrepresent YTD.
 */
const ytdFacts = (history: HistoricalMarketPeriod[]): NarrativeContextFact[] => {
  const current = history[0];
  if (!current) return [];
  const currentPeriod = parsePeriod(current.period);
  if (!currentPeriod) return [];
  const yearQuarters: HistoricalMarketPeriod[] = [];
  for (let quarter = 1; quarter <= currentPeriod.quarter; quarter++) {
    const match = history.find((item) => {
      const parsed = parsePeriod(item.period);
      return parsed && parsed.year === currentPeriod.year && parsed.quarter === quarter;
    });
    if (!match) return [];
    yearQuarters.push(match);
  }
  const entries: NarrativeContextFact[] = [];
  const ytd = (
    key: string,
    label: string,
    value: number,
    displayValue: string,
  ) =>
    entries.push(
      fact({
        contextKey: `ytd.${key}`,
        category: "trend",
        label,
        value,
        displayValue,
        sourceType: "Report_Data_Service",
        authority: `Deterministic sum of ${currentPeriod.year} Q1–Q${currentPeriod.quarter}`,
        calculation: `Sum of governed quarterly values for ${currentPeriod.year} Q1 through Q${currentPeriod.quarter}`,
        internalSourceIds: [],
        analyticalType: "trend",
        editorialPriority: "background",
      }),
    );
  const sum = (values: (number | null | undefined)[]) =>
    values.every((value) => typeof value === "number" && Number.isFinite(value))
      ? (values as number[]).reduce((total, value) => total + value, 0)
      : null;
  const absorption = sum(yearQuarters.map((item) => item.quarterlyNetAbsorptionSf));
  if (absorption != null) ytd("net_absorption", `YTD net absorption (${currentPeriod.year})`, absorption, unsignedSf(absorption));
  const leasing = sum(yearQuarters.map((item) => item.leasingActivitySf));
  if (leasing != null) ytd("leasing_activity", `YTD leasing activity (${currentPeriod.year})`, leasing, unsignedSf(leasing));
  const deliveries = sum(yearQuarters.map((item) => item.deliveredSf));
  if (deliveries != null) ytd("deliveries", `YTD deliveries (${currentPeriod.year})`, deliveries, unsignedSf(deliveries));
  const sales = sum(yearQuarters.map((item) => item.salesVolume));
  if (sales != null) ytd("sales_volume", `YTD sales volume (${currentPeriod.year})`, sales, dollars(sales));
  return entries;
};

/** Highs/lows, positive/negative streaks, and multi-quarter averages. */
const historicalContextFacts = (history: HistoricalMarketPeriod[]): NarrativeContextFact[] => {
  const entries: NarrativeContextFact[] = [];
  const historical = (
    key: string,
    label: string,
    value: number,
    displayValue: string,
    calculation: string,
  ) =>
    entries.push(
      fact({
        contextKey: `historical.${key}`,
        category: "historical",
        label,
        value,
        displayValue,
        sourceType: "Report_Data_Service",
        authority: "Deterministic calculation over available governed history",
        calculation,
        internalSourceIds: [],
        analyticalType: "historical",
        editorialPriority: "supporting",
      }),
    );

  if (history.length >= 3) {
    const extremes = (
      key: string,
      label: string,
      unit: "rate" | "sf" | "currency",
      accessor: (item: HistoricalMarketPeriod) => number | null | undefined,
    ) => {
      const rows = history
        .map((item) => ({ item, value: accessor(item) }))
        .filter((row): row is { item: HistoricalMarketPeriod; value: number } => typeof row.value === "number" && Number.isFinite(row.value));
      if (rows.length < 3) return;
      const format = unit === "rate" ? percentage : unit === "currency" ? dollars : unsignedSf;
      const oldest = rows[rows.length - 1]!.item.period;
      const highest = rows.reduce((max, row) => (row.value > max.value ? row : max));
      const lowest = rows.reduce((min, row) => (row.value < min.value ? row : min));
      historical(`${key}.highest`, `${label} — highest since ${oldest}`, highest.value, `${format(highest.value)} (${highest.item.period})`, `Maximum ${label.toLocaleLowerCase()} across governed history from ${oldest} through ${rows[0]!.item.period}`);
      historical(`${key}.lowest`, `${label} — lowest since ${oldest}`, lowest.value, `${format(lowest.value)} (${lowest.item.period})`, `Minimum ${label.toLocaleLowerCase()} across governed history from ${oldest} through ${rows[0]!.item.period}`);
    };
    extremes("vacancy", "Vacancy rate", "rate", (item) => item.vacancyRate);
    extremes("availability", "Availability rate", "rate", (item) => item.availabilityRate);
    extremes("net_absorption", "Quarterly net absorption", "sf", (item) => item.quarterlyNetAbsorptionSf);
    extremes("leasing_activity", "Quarterly leasing activity", "sf", (item) => item.leasingActivitySf);
    extremes("under_construction", "Under construction", "sf", (item) => item.underConstructionSf);
    extremes("sales_volume", "Sales volume", "currency", (item) => item.salesVolume ?? null);
  }

  const absorptionStreak = signStreak(history.map((item) => item.quarterlyNetAbsorptionSf));
  if (absorptionStreak && absorptionStreak.count >= 2)
    historical(
      "net_absorption.streak",
      `Net absorption ${absorptionStreak.positive ? "positive" : "negative"} streak`,
      absorptionStreak.count,
      `${absorptionStreak.count} consecutive quarters of ${absorptionStreak.positive ? "positive" : "negative"} net absorption`,
      `Count of consecutive quarters ending ${history[0]!.period} with ${absorptionStreak.positive ? "positive" : "negative"} net absorption`,
    );

  const directionalStreak = (accessor: (item: HistoricalMarketPeriod) => number | null, label: string, key: string) => {
    if (history.length < 2) return;
    // An authoritative null ends the streak (it is never compared as zero).
    const step = (index: number, compare: (a: number, b: number) => boolean) => {
      const a = accessor(history[index]!);
      const b = accessor(history[index + 1]!);
      return a != null && b != null && compare(a, b);
    };
    let rising = 0;
    while (rising < history.length - 1 && step(rising, (a, b) => a > b)) rising += 1;
    let falling = 0;
    while (falling < history.length - 1 && step(falling, (a, b) => a < b)) falling += 1;
    const streakQuarters = Math.max(rising, falling) + 1;
    if (streakQuarters < 2) return;
    const direction = rising >= falling ? "rising" : "falling";
    historical(
      `${key}.trend_streak`,
      `${label} ${direction} streak`,
      streakQuarters,
      `${label} has been ${direction} for ${streakQuarters} consecutive quarters`,
      `Count of consecutive quarters ending ${history[0]!.period} with ${label.toLocaleLowerCase()} strictly ${direction}`,
    );
  };
  directionalStreak((item) => item.vacancyRate, "Vacancy", "vacancy");
  directionalStreak((item) => item.availabilityRate, "Availability", "availability");

  const average = (count: number, offset = 0) => {
    const window = history.slice(offset, offset + count);
    if (window.length < count) return null;
    if (window.some((item) => item.quarterlyNetAbsorptionSf == null)) return null;
    return window.reduce((total, item) => total + item.quarterlyNetAbsorptionSf!, 0) / count;
  };
  const average4 = average(4);
  if (average4 != null)
    historical("net_absorption.avg_4q", "4-quarter average net absorption", average4, sf(average4), "Average quarterly net absorption over the trailing 4 quarters (current quarter included)");
  const average8 = average(8);
  if (average8 != null)
    historical("net_absorption.avg_8q", "8-quarter average net absorption", average8, sf(average8), "Average quarterly net absorption over the trailing 8 quarters (current quarter included)");
  const priorFourAverage = average(4, 1);
  const currentAbsorption = history[0]?.quarterlyNetAbsorptionSf;
  if (priorFourAverage != null && currentAbsorption != null)
    historical(
      "net_absorption.vs_prior_4q_avg",
      "Current quarter vs. recent average",
      currentAbsorption - priorFourAverage,
      `${currentAbsorption >= priorFourAverage ? "above" : "below"} the prior 4-quarter average by ${unsignedSf(Math.abs(currentAbsorption - priorFourAverage))}`,
      "Current quarterly net absorption minus the average of the 4 quarters preceding it",
    );
  const priorLeasingWindow = history.slice(1, 5);
  const currentLeasing = history[0]?.leasingActivitySf;
  if (
    priorLeasingWindow.length === 4 &&
    currentLeasing != null &&
    priorLeasingWindow.every((item) => item.leasingActivitySf != null)
  ) {
    const priorLeasingAverage =
      priorLeasingWindow.reduce((total, item) => total + item.leasingActivitySf!, 0) / 4;
    const difference = currentLeasing - priorLeasingAverage;
    historical(
      "leasing_activity.vs_prior_4q_avg",
      "Leasing activity vs. recent average",
      difference,
      `${difference >= 0 ? "above" : "below"} the prior 4-quarter average of ${unsignedSf(priorLeasingAverage)} by ${unsignedSf(Math.abs(difference))}`,
      "Current quarterly leasing activity minus the average of the 4 quarters preceding it",
    );
  }

  return entries;
};

/**
 * A null history value is an authoritative null (e.g. a first-class Overall
 * Market row that intentionally publishes no value). Streaks stop at it;
 * it is never treated as zero.
 */
const signStreak = (values: (number | null)[]) => {
  if (!values.length || values[0] === 0 || values[0] == null) return undefined;
  const positive = values[0]! > 0;
  let count = 0;
  for (const value of values) {
    if (value == null || value === 0 || positive !== value > 0) break;
    count += 1;
  }
  return { count, positive };
};

/**
 * Deterministic turning points in governed history. These describe what
 * changed, never why, and never project forward.
 */
const inflectionFacts = (history: HistoricalMarketPeriod[]): NarrativeContextFact[] => {
  const entries: NarrativeContextFact[] = [];
  const [current, previous, earlier] = history;
  if (!current || !previous) return entries;
  const inflection = (
    key: string,
    label: string,
    value: number,
    displayValue: string,
    calculation: string,
    extra: Partial<NarrativeContextFact> = {},
  ) =>
    entries.push(
      fact({
        contextKey: `inflection.${key}`,
        category: "historical",
        label,
        value,
        displayValue,
        sourceType: "Report_Data_Service",
        authority: "Deterministic turning point in governed history",
        calculation,
        internalSourceIds: [],
        analyticalType: "inflection",
        editorialPriority: "lead",
        causalSupport: false,
        ...extra,
      }),
    );

  // First positive (negative) quarter after a negative (positive) streak.
  const currentAbsorption = current.quarterlyNetAbsorptionSf;
  if (currentAbsorption != null && currentAbsorption !== 0) {
    const flipped = signStreak(history.slice(1).map((item) => item.quarterlyNetAbsorptionSf));
    if (
      flipped &&
      flipped.positive !== currentAbsorption > 0 &&
      flipped.count >= 2
    ) {
      const nowPositive = currentAbsorption > 0;
      inflection(
        `net_absorption.first_${nowPositive ? "positive" : "negative"}_after_streak`,
        `First ${nowPositive ? "positive" : "negative"} absorption quarter after a ${nowPositive ? "negative" : "positive"} streak`,
        flipped.count,
        `${sf(currentAbsorption)} of net absorption, the first ${nowPositive ? "positive" : "negative"} quarter after ${flipped.count} consecutive ${nowPositive ? "negative" : "positive"} quarters`,
        "Sign of current quarterly net absorption versus the preceding same-sign streak",
        { currentValue: current.quarterlyNetAbsorptionSf, priorValue: previous.quarterlyNetAbsorptionSf },
      );
    }
  }

  const reversal = (
    key: "vacancy" | "availability",
    label: string,
    accessor: (item: HistoricalMarketPeriod) => number | null,
  ) => {
    if (!earlier) return;
    const now = accessor(current);
    const before = accessor(previous);
    const earliest = accessor(earlier);
    if (now == null || before == null || earliest == null) return;
    const latest = (now - before) * 10_000;
    const prior = (before - earliest) * 10_000;
    if (Math.abs(latest) < 1 || Math.abs(prior) < 1) return;
    if (Math.sign(latest) === Math.sign(prior)) return;
    inflection(
      `${key}.direction_reversal`,
      `${label} direction reversal`,
      latest,
      `${label} ${latest > 0 ? "rose" : "fell"} ${Math.abs(Math.round(latest))} basis points to ${percentage(now)} after ${prior > 0 ? "rising" : "falling"} ${Math.abs(Math.round(prior))} basis points the prior quarter`,
      `Sign of ${label.toLocaleLowerCase()} QoQ change versus the prior quarter's change`,
      { currentValue: now, priorValue: before, changeValue: latest },
    );
  };
  reversal("vacancy", "Vacancy", (item) => item.vacancyRate);
  reversal("availability", "Availability", (item) => item.availabilityRate);

  if (
    current.underConstructionSf != null &&
    current.underConstructionSf > 0 &&
    previous.underConstructionSf === 0
  )
    inflection(
      "construction.reactivation",
      "Construction pipeline reactivated",
      current.underConstructionSf,
      `${unsignedSf(current.underConstructionSf)} under construction after no space was under construction in ${previous.period}`,
      "Under-construction SF is positive this quarter and zero the prior quarter",
      { currentValue: current.underConstructionSf, priorValue: 0 },
    );

  if (
    previous.leasingActivitySf != null &&
    current.leasingActivitySf != null &&
    previous.leasingActivitySf > 0
  ) {
    const change = ((current.leasingActivitySf - previous.leasingActivitySf) / previous.leasingActivitySf) * 100;
    if (Math.abs(change) >= 10)
      inflection(
        `leasing_activity.${change > 0 ? "acceleration" : "deceleration"}`,
        `Leasing ${change > 0 ? "acceleration" : "deceleration"} vs. prior quarter`,
        change,
        `Leasing activity ${change > 0 ? "accelerated" : "decelerated"} ${Math.abs(change).toFixed(1)}% from ${previous.period}`,
        "Quarter-over-quarter percent change in leasing activity SF, reported when at least 10%",
        { currentValue: current.leasingActivitySf, priorValue: previous.leasingActivitySf, editorialPriority: "supporting" },
      );
  }
  return entries;
};

/** Deterministic counts of the quarter's full governed record sets (not capped for display). */
const countFacts = (records: {
  leases: LeaseRecord[];
  sales: SaleRecord[];
  availabilities: PropertyHighlight[];
  construction: PropertyHighlight[];
  deliveries: PropertyHighlight[];
}): NarrativeContextFact[] => {
  const count = (key: string, label: string, value: number) =>
    fact({
      contextKey: `count.${key}`,
      category: "count",
      label,
      value,
      displayValue: `${value.toLocaleString("en-US")}`,
      sourceType: "Report_Data_Service",
      authority: "Deterministic count of governed quarter records",
      calculation: `Count of ${label.toLocaleLowerCase()} records for the current quarter`,
      internalSourceIds: [],
      analyticalType: "count",
      editorialPriority: "background",
    });
  return [
    count("leases", "Lease count", records.leases.length),
    count("sales", "Sale count", records.sales.length),
    count("construction_projects", "Active construction project count", records.construction.length),
    count("deliveries", "Delivery count", records.deliveries.length),
    count("availabilities", "Availability count", records.availabilities.length),
  ];
};

const isSpeculative = (item: PropertyHighlight) => /spec/i.test(item.type ?? item.constructionType ?? "");
const isBts = (item: PropertyHighlight) => /built.?to.?suit|\bbts\b/i.test(item.type ?? item.constructionType ?? "");

/**
 * Speculative vs. built-to-suit composition of the quarter's construction
 * pipeline. Descriptive only: a composition threshold is never a cause.
 */
const compositionFacts = (
  construction: PropertyHighlight[],
  speculativeShare: number,
): NarrativeContextFact[] => {
  if (!construction.length) return [];
  const totalSf = construction.reduce((total, item) => total + item.sizeSf, 0);
  if (!totalSf) return [];
  const specSf = construction.filter(isSpeculative).reduce((total, item) => total + item.sizeSf, 0);
  const btsSf = construction.filter(isBts).reduce((total, item) => total + item.sizeSf, 0);
  const specCount = construction.filter(isSpeculative).length;
  const btsCount = construction.filter(isBts).length;
  const composition = (
    key: string,
    label: string,
    value: number | string,
    displayValue: string,
    calculation: string,
    priority: NarrativeContextFact["editorialPriority"] = "supporting",
  ) =>
    fact({
      contextKey: `composition.${key}`,
      category: "composition",
      label,
      value,
      displayValue,
      sourceType: "Market_Data_Contributor__c",
      authority: "Deterministic composition of quarter-scoped construction records",
      calculation,
      internalSourceIds: [],
      analyticalType: "composition",
      editorialPriority: priority,
    });
  const entries = [
    composition("speculative_sf", "Speculative SF under construction", specSf, unsignedSf(specSf), "Sum of tracked under-construction SF flagged Speculative"),
    composition("bts_sf", "Built-to-suit SF under construction", btsSf, unsignedSf(btsSf), "Sum of tracked under-construction SF flagged Built-to-Suit"),
    composition("speculative_share", "Speculative share of tracked construction", specSf / totalSf, percentage(specSf / totalSf), "Speculative SF ÷ total tracked under-construction SF"),
    composition("bts_share", "Built-to-suit share of tracked construction", btsSf / totalSf, percentage(btsSf / totalSf), "Built-to-suit SF ÷ total tracked under-construction SF"),
    composition("project_counts", "Construction projects by type", specCount + btsCount, `${specCount} speculative · ${btsCount} built-to-suit`, "Count of tracked construction projects by type", "background"),
  ];
  if (Number.isFinite(speculativeShare) && speculativeShare < 0.15)
    entries.push(composition("speculative_pipeline_limited", "Limited speculative pipeline", "limited", "The speculative development pipeline is limited relative to total under-construction SF", "Governed speculative share of under-construction SF is below 15%"));
  if (btsSf / totalSf > 0.65)
    entries.push(composition("construction_bts_dominant", "Built-to-suit dominated pipeline", "bts_dominant", "The tracked construction pipeline is dominated by built-to-suit development rather than speculative supply", "Built-to-suit SF exceeds 65% of tracked under-construction SF"));
  return entries;
};

/** Leasing concentration in large (500k SF+) transactions relative to the quarter's total. */
const concentrationFacts = (
  leases: LeaseRecord[],
  currentLeasingActivitySf: number | undefined,
): NarrativeContextFact[] => {
  if (!leases.length) return [];
  const large = leases.filter((lease) => lease.sizeSf >= 500_000);
  if (!large.length) return [];
  const largeSf = large.reduce((total, lease) => total + lease.sizeSf, 0);
  const concentration = (
    key: string,
    label: string,
    value: number | string,
    displayValue: string,
    calculation: string,
    sourceType: NarrativeContextFact["sourceType"],
    extra: Partial<NarrativeContextFact> = {},
  ) =>
    fact({
      contextKey: `concentration.${key}`,
      category: "concentration",
      label,
      value,
      displayValue,
      sourceType,
      authority: "Deterministic calculation over quarter-scoped lease records",
      calculation,
      internalSourceIds: [],
      analyticalType: "concentration",
      editorialPriority: "supporting",
      ...extra,
    });
  const entries: NarrativeContextFact[] = [
    concentration("large_lease_count", "500k SF+ lease count", large.length, `${large.length}`, "Count of tracked leases with size ≥ 500,000 SF", "Market_Data_Contributor__c"),
    concentration("large_lease_sf", "SF from 500k SF+ leases", largeSf, unsignedSf(largeSf), "Sum of tracked lease SF with size ≥ 500,000 SF", "Market_Data_Contributor__c"),
  ];
  if (currentLeasingActivitySf) {
    const ratio = largeSf / currentLeasingActivitySf;
    entries.push(concentration("large_lease_share", "Share of leasing volume from 500k SF+ leases", ratio, percentage(ratio), "SF from tracked leases ≥ 500,000 SF ÷ governed quarterly leasing activity SF", "Report_Data_Service", { materialityPercent: ratio * 100 }));
    if (ratio > 0.4)
      entries.push(concentration("large_lease_dominant", "Leasing concentrated in large leases", "concentrated", `A large share of quarterly leasing volume is concentrated in leases of 500,000 SF or more (${percentage(ratio)})`, "SF from tracked leases ≥ 500,000 SF exceeds 40% of governed quarterly leasing activity", "Report_Data_Service", { materialityPercent: ratio * 100, editorialPriority: "lead" }));
  }
  return entries;
};

// --- Governed explanatory facts (Market Data Engine) -----------------------

const GOVERNED_CAUSAL_TYPES: ReadonlySet<NarrativeAnalyticalType> = new Set<NarrativeAnalyticalType>([
  "vacancy_bridge",
  "availability_bridge",
  "absorption_bridge",
  "leasing_conversion",
  "pipeline_change",
  "market_driver",
]);

/**
 * Market Data Engine evidence semantics (market-explanation-v1):
 *   confirmed  causal wording allowed
 *   strong     causal wording allowed, without overstating certainty
 *   indicative never converted into a definitive cause
 */
const licensesCause = (strength: NarrativeEvidenceStrength) =>
  strength === "confirmed" || strength === "strong";

/** Governed driver types that describe a movement rather than explain it. */
const DESCRIPTIVE_DRIVER_TYPES = new Set(["unknown", "availability_removed"]);

const driverPhrase = (driverType: string) => driverType.replace(/_/g, " ");

/**
 * Converts governed explanatory contributor facts into context facts. The
 * engine owns the bridge math, driver taxonomy, materiality, evidence
 * strength, construction type and historical authority; this only
 * sanitizes, annotates, and applies the wording policy above. A legacy
 * unversioned prior quarter is preserved as provenance, not re-adjudicated.
 */
const governedExplanatoryFacts = (
  facts: GovernedExplanatoryFact[] | undefined,
  reportPeriod: string,
): NarrativeContextFact[] => {
  const counters = new Map<string, number>();
  const reportOrdinal = periodOrdinal(reportPeriod);
  return (facts ?? [])
    .filter((item) => item.narrativeEligible === true && item.isConfidential !== true)
    .flatMap((item) => {
      const label = safeSentence(item.label);
      const displayValue = safeSentence(item.displayValue);
      if (!label || !displayValue) return [];
      const trusted = item.trusted !== false;
      const strength: NarrativeEvidenceStrength = trusted
        ? (item.evidenceStrength ?? "unspecified")
        : "unspecified";
      const driverType = trusted && item.driverType ? safeToken(item.driverType) || undefined : undefined;
      const index = (counters.get(item.factType) ?? 0) + 1;
      counters.set(item.factType, index);
      const commencementOrdinal = item.commencementPeriod
        ? periodOrdinal(item.commencementPeriod)
        : null;
      const futureCommencement =
        item.factType === "leasing_conversion" &&
        commencementOrdinal != null &&
        reportOrdinal != null &&
        commencementOrdinal > reportOrdinal;
      const notes: string[] = [];
      if (item.factType === "leasing_conversion" && item.commencementPeriod)
        notes.push(
          futureCommencement
            ? `signed${item.signedPeriod ? ` ${item.signedPeriod}` : ""}; occupancy commences ${item.commencementPeriod}, after this report period, so it is not yet reflected in absorption or vacancy`
            : `occupancy commenced ${item.commencementPeriod}`,
        );
      const causal =
        trusted &&
        GOVERNED_CAUSAL_TYPES.has(item.factType) &&
        licensesCause(strength) &&
        Boolean(driverType) &&
        !DESCRIPTIVE_DRIVER_TYPES.has(driverType!);
      if (causal)
        notes.push(
          strength === "confirmed"
            ? `governed cause: ${driverPhrase(driverType!)}, confirmed`
            : `governed cause: ${driverPhrase(driverType!)}, strong evidence; state it without overstating certainty`,
        );
      else
        notes.push(
          trusted
            ? "measured change only; the governed evidence does not establish a cause"
            : "measured change only; structured evidence unavailable",
        );
      if (item.submarketTransfer)
        notes.push("reflects a submarket reassignment, not market activity");
      const constructionType = item.constructionType
        ? safeToken(item.constructionType, 40) || undefined
        : undefined;
      if (item.factType === "pipeline_change" || constructionType)
        notes.push(
          constructionType && constructionType.toLocaleLowerCase() !== "unknown"
            ? `construction type: ${constructionType}`
            : "construction type not classified",
        );
      const timing = item.availability?.timingClassification;
      if (timing && timing !== "unknown")
        notes.push(`availability timing: ${safeToken(timing, 40)}`);
      const entityNames = [item.propertyName, item.tenantName, item.address]
        .map((value) => safeText(value))
        .filter(Boolean);
      const materiality = item.materialityPercent ?? null;
      const comparisonWarnings = (item.comparisonWarnings ?? [])
        .map((warning) => safeSentence(warning))
        .filter(Boolean);
      return [
        fact({
          contextKey: `governed.${item.factType}.${index}`,
          category: item.factType === "market_breadth" ? "ranking" : "market_driver",
          label: `${label} (${notes.join("; ")})`,
          value: item.value ?? item.changeValue ?? displayValue,
          displayValue,
          sourceType: "Market_Data_Contributor__c",
          authority: "Governed Market Data Engine explanatory contributor",
          internalSourceIds: [],
          entityNames,
          analyticalType: item.factType,
          driverType,
          evidenceStrength: strength,
          causalSupport: causal,
          priorValue: item.priorValue ?? undefined,
          currentValue: item.currentValue ?? undefined,
          changeValue:
            item.factType === "pipeline_change" && item.pipelineEventSf != null
              ? item.pipelineEventSf
              : (item.changeValue ?? undefined),
          materialityPercent: materiality ?? undefined,
          constructionType,
          explanationProvenance: {
            version: item.explanationVersion,
            priorSnapshotProvenance: item.priorSnapshotProvenance,
            priorSnapshotHash: item.priorSnapshotHash,
            comparisonWarnings: comparisonWarnings.length ? comparisonWarnings : undefined,
            trusted,
          },
          editorialPriority: causal
            ? materiality == null || Math.abs(materiality) >= 20
              ? "lead"
              : "supporting"
            : trusted
              ? "supporting"
              : "background",
        }),
      ];
    });
};

/** Property-level absorption contributors (governed ranking, composition only). */
const absorptionDriverFacts = (
  report: IndustrialMarketReport,
  marketId: string,
  direct: AbsorptionContributor[],
  netAbsorption: number | null,
  provenancePrefix = "",
) => {
  const overall = marketId === OVERALL_MARKET_NARRATIVE_ID;
  const identity = overall ? undefined : resolveChicagoSubmarket(marketId);
  const materiality = (contribution: number) =>
    netAbsorption && Math.sign(netAbsorption) === Math.sign(contribution)
      ? Math.round((Math.abs(contribution) / Math.abs(netAbsorption)) * 1000) / 10
      : undefined;
  const contributorMeta = (contribution: number): Partial<NarrativeContextFact> => ({
    analyticalType: "materiality",
    // A property-level contribution is a component of net absorption, not
    // an explanation of vacancy or availability movement.
    causalSupport: false,
    evidenceStrength: "unspecified",
    driverType: contribution >= 0 ? "property_move_in" : "property_move_out",
    materialityPercent: materiality(contribution),
    editorialPriority: "supporting",
  });
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
            ...contributorMeta(item.contributionSf),
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
          ...contributorMeta(contribution),
        });
      });
  return [...build("positive"), ...build("negative")];
};

// --- Transaction materiality ------------------------------------------------

interface MaterialityInput {
  rankIndex: number;
  amount: number;
  quarterTotal: number | null;
  largeThreshold: number;
  mediumThreshold: number;
  driverLinked: boolean;
  /** Strongest governed evidence among drivers naming this transaction. */
  driverEvidence?: NarrativeEvidenceStrength;
}

/**
 * Narrative materiality for one transaction. A transaction earns narrative
 * mention when a governed driver with strong or moderate evidence names it,
 * or when rank, absolute size, share of the quarter's total and any weaker
 * driver link together reach the minimum score. Ranking third in a quiet
 * quarter is not, on its own, material.
 */
export function transactionMateriality(input: MaterialityInput) {
  const ratio =
    input.quarterTotal && input.quarterTotal > 0
      ? input.amount / input.quarterTotal
      : null;
  const strongDriver =
    input.driverLinked && licensesCause(input.driverEvidence ?? "strong");
  let score = 0;
  if (strongDriver) score += 3;
  else if (input.driverLinked) score += 1;
  if (ratio != null) {
    if (ratio >= TRANSACTION_MATERIALITY.majorShare) score += 2;
    else if (ratio >= TRANSACTION_MATERIALITY.notableShare) score += 1;
  }
  // Absolute scale alone (500k SF+ lease, $100M+ sale) is material.
  if (input.amount >= input.largeThreshold) score += 3;
  else if (input.amount >= input.mediumThreshold) score += 1;
  if (input.rankIndex === 0) score += 1;
  return {
    score,
    share: ratio,
    material: strongDriver || score >= TRANSACTION_MATERIALITY.minScore,
  };
}

const EVIDENCE_RANK: Record<NarrativeEvidenceStrength, number> = {
  confirmed: 3,
  strong: 2,
  indicative: 1,
  unspecified: 0,
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
  options: {
    overall: boolean;
    pageContext: NarrativePageContext;
    quarterLeasingSf: number | null;
    quarterSalesVolume: number | null;
    /** Normalized governed entity name → strongest evidence naming it. */
    governedEntities: Map<string, NarrativeEvidenceStrength>;
  },
  provenancePrefix = "",
) => {
  const facts: NarrativeContextFact[] = [];
  const driverLink = (...names: string[]) => {
    const strengths = names
      .filter(Boolean)
      .map((name) => options.governedEntities.get(normalizedEntity(name)))
      .filter((value): value is NarrativeEvidenceStrength => Boolean(value));
    if (!strengths.length) return { driverLinked: false };
    return {
      driverLinked: true,
      driverEvidence: strengths.reduce((best, value) =>
        EVIDENCE_RANK[value] > EVIDENCE_RANK[best] ? value : best,
      ),
    };
  };
  const visibleLeases = new Set(records.leases.slice(0, NARRATIVE_MATERIALITY.visibleTableRows));
  const visibleSales = new Set(records.sales.slice(0, NARRATIVE_MATERIALITY.visibleTableRows));

  [...records.leases]
    .filter((lease) => lease.isDealConfidential === false)
    .sort((a, b) => b.sizeSf - a.sizeSf)
    .map((lease, rankIndex) => {
      const tenant = safeText(lease.tenantDisplayName ?? lease.tenant);
      const address = safeText(lease.address);
      return {
        lease,
        tenant,
        address,
        assessment: transactionMateriality({
          rankIndex,
          amount: lease.sizeSf,
          quarterTotal: options.quarterLeasingSf,
          largeThreshold: TRANSACTION_MATERIALITY.leaseLargeSf,
          mediumThreshold: TRANSACTION_MATERIALITY.leaseMediumSf,
          ...driverLink(tenant, address),
        }),
      };
    })
    .filter(({ assessment }) => assessment.material)
    .slice(0, options.overall ? NARRATIVE_MATERIALITY.overallLeases : NARRATIVE_MATERIALITY.submarketLeases)
    .forEach(({ lease, tenant, address, assessment }, index) => {
      facts.push(fact({
        contextKey: `lease.${index + 1}`,
        category: "lease",
        label: tenant || "Published tenant unavailable",
        value: lease.sizeSf,
        displayValue: [tenant, unsignedSf(lease.sizeSf), address, safeText(lease.leaseType)].filter(Boolean).join(" · "),
        sourceType: "Market_Data_Contributor__c",
        authority: "Quarter-scoped publication-safe contributor finalist meeting narrative materiality",
        internalSourceIds: provenanceIds(report, `${provenancePrefix}leasing.${records.leases.indexOf(lease)}`),
        entityNames: [tenant, address].filter(Boolean),
        analyticalType: "lease",
        materialityPercent: assessment.share == null ? undefined : Math.round(assessment.share * 1000) / 10,
        editorialPriority: assessment.score >= 5 ? "lead" : "supporting",
        visibleOn: visibleLeases.has(lease) && options.pageContext.topLeasesVisible ? ["top_leases"] : [],
      }));
    });

  [...records.sales]
    .sort((a, b) => b.price - a.price)
    .map((sale, rankIndex) => {
      const buyer = safeText(sale.buyer);
      const address = safeText(sale.address);
      return {
        sale,
        buyer,
        address,
        assessment: transactionMateriality({
          rankIndex,
          amount: sale.price,
          quarterTotal: options.quarterSalesVolume,
          largeThreshold: TRANSACTION_MATERIALITY.saleLargeUsd,
          mediumThreshold: TRANSACTION_MATERIALITY.saleMediumUsd,
          ...driverLink(buyer, address),
        }),
      };
    })
    .filter(({ assessment }) => assessment.material)
    .slice(0, options.overall ? NARRATIVE_MATERIALITY.overallSales : NARRATIVE_MATERIALITY.submarketSales)
    .forEach(({ sale, buyer, address, assessment }, index) => {
      facts.push(fact({
        contextKey: `sale.${index + 1}`,
        category: "sale",
        label: buyer || "Published buyer unavailable",
        value: sale.price,
        displayValue: [buyer, dollars(sale.price), address, safeText(sale.saleType)].filter(Boolean).join(" · "),
        sourceType: "Market_Data_Contributor__c",
        authority: "Quarter-scoped publication-safe contributor finalist meeting narrative materiality",
        internalSourceIds: provenanceIds(report, `${provenancePrefix}sales.${records.sales.indexOf(sale)}`),
        entityNames: [buyer, address].filter(Boolean),
        analyticalType: "sale",
        materialityPercent: assessment.share == null ? undefined : Math.round(assessment.share * 1000) / 10,
        editorialPriority: assessment.score >= 5 ? "lead" : "supporting",
        visibleOn: visibleSales.has(sale) && options.pageContext.topSalesVisible ? ["top_sales"] : [],
      }));
    });

  const addProperties = (
    category: "availability" | "construction" | "delivery",
    items: PropertyHighlight[],
    limit: number,
  ) => {
    const visible = new Set(items.slice(0, NARRATIVE_MATERIALITY.visibleTableRows));
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
          displayValue: [address, unsignedSf(item.sizeSf), safeText(item.type), developer].filter(Boolean).join(" · "),
          sourceType: category === "availability" ? "Property_Data__c" : "Market_Data_Contributor__c",
          authority: `Quarter-scoped ${category} finalist`,
          internalSourceIds: provenanceIds(report, `${provenancePrefix}${category === "delivery" ? "deliveries" : `${category}s`}.${items.indexOf(item)}`),
          entityNames: [address, developer].filter(Boolean),
          analyticalType: category,
          editorialPriority: "background",
          visibleOn: visible.has(item) && options.pageContext.propertyCardsVisible ? ["property_cards"] : [],
        }));
      });
  };
  addProperties("availability", records.availabilities, NARRATIVE_MATERIALITY.availabilities);
  addProperties("construction", records.construction, NARRATIVE_MATERIALITY.construction);
  addProperties("delivery", records.deliveries, NARRATIVE_MATERIALITY.deliveries);
  return facts;
};

// --- Overall market rankings and breadth ------------------------------------

const rankingFacts = (report: IndustrialMarketReport, pageContext: NarrativePageContext) => {
  const facts: NarrativeContextFact[] = [];
  const table: NarrativePageComponent[] = pageContext.submarketTableVisible ? ["submarket_table"] : [];
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
          displayValue: `${safeText(row.displayName ?? row.name)} · ${formatter(Number(row[metric]))}`,
          sourceType: "Market_Data__c",
          authority: "Deterministic ranking of the 18 canonical submarkets",
          calculation: `Sort canonical submarkets by ${String(metric)} ${direction === "leader" ? "descending" : "ascending"}`,
          internalSourceIds: provenanceIds(report, `submarkets.${row.name}.${String(metric)}`),
          entityNames: [...new Set([safeText(row.name), safeText(row.displayName ?? row.name)])].filter(Boolean),
          analyticalType: "ranking",
          editorialPriority: index === 0 ? "supporting" : "background",
          visibleOn: table,
        })),
      ),
    );
  };
  rank("quarterlyNetAbsorptionSf", "Quarterly absorption", sf);
  rank("vacancyRate", "Vacancy", percentage);
  rank("availabilityRate", "Availability", percentage);
  rank("underConstructionSf", "Under construction", unsignedSf);
  rank("salesVolume", "Sales volume", dollars);

  // Leasing activity is not a MarketMetrics field on report.submarkets — it
  // lives on each submarket's current-quarter historicalPeriods row. Only
  // rank it when every canonical submarket has that row, so the leaderboard
  // never silently ranks an incomplete population.
  const leasingBySubmarket = report.submarketDetails
    .map((detail) => ({
      name: detail.displayName ?? detail.canonicalName ?? detail.name,
      leasingActivitySf: detail.historicalPeriods.find(
        (item) => item.period === report.report.period,
      )?.leasingActivitySf,
    }))
    .filter(
      (row): row is { name: string; leasingActivitySf: number } =>
        typeof row.leasingActivitySf === "number",
    );
  if (leasingBySubmarket.length === report.submarketDetails.length && leasingBySubmarket.length > 0) {
    const ordered = [...leasingBySubmarket].sort((a, b) => b.leasingActivitySf - a.leasingActivitySf);
    const sets = [
      ["leader", ordered.slice(0, NARRATIVE_MATERIALITY.leaderboard)],
      ["laggard", ordered.slice(-NARRATIVE_MATERIALITY.leaderboard).reverse()],
    ] as const;
    sets.forEach(([direction, rows]) =>
      rows.forEach((row, index) =>
        facts.push(fact({
          contextKey: `submarket_rank.leasingActivitySf.${direction}.${index + 1}`,
          category: "ranking",
          label: `Leasing activity ${direction}`,
          value: row.leasingActivitySf,
          displayValue: `${safeText(row.name)} · ${unsignedSf(row.leasingActivitySf)}`,
          sourceType: "Market_Data__c",
          authority: "Deterministic ranking of the 18 canonical submarkets",
          calculation: `Sort canonical submarkets by current-quarter leasing activity SF ${direction === "leader" ? "descending" : "ascending"}`,
          internalSourceIds: [],
          entityNames: [safeText(row.name)],
          analyticalType: "ranking",
          editorialPriority: index === 0 ? "supporting" : "background",
        })),
      ),
    );
  }
  return facts;
};

/**
 * Overall-market breadth and dispersion across the 18 canonical submarkets.
 * Deterministic and publication-safe. A breadth measure the Market Data
 * Engine already supplies (a governed market_breadth fact with the same
 * driverType) is not recalculated here.
 */
export function marketBreadthFacts(
  report: IndustrialMarketReport,
  suppliedDriverTypes: ReadonlySet<string> = new Set(),
): NarrativeContextFact[] {
  const entries: NarrativeContextFact[] = [];
  const submarkets = report.submarkets;
  if (!submarkets.length) return entries;
  const total = submarkets.length;
  const name = (row: { name: string; displayName?: string }) => safeText(row.displayName ?? row.name);
  const breadth = (
    key: string,
    label: string,
    value: number,
    displayValue: string,
    calculation: string,
    extra: Partial<NarrativeContextFact> = {},
  ) => {
    if (suppliedDriverTypes.has(key)) return;
    entries.push(
      fact({
        contextKey: `breadth.${key}`,
        category: "ranking",
        label,
        value,
        displayValue,
        sourceType: "Report_Data_Service",
        authority: "Deterministic breadth calculation across the 18 canonical submarkets",
        calculation,
        internalSourceIds: [],
        analyticalType: "market_breadth",
        driverType: key,
        editorialPriority: "supporting",
        ...extra,
      }),
    );
  };

  const absorption = submarkets.map((row) => ({
    row,
    value: resolvePresentationValue(report, `submarkets.${row.name}.quarterlyNetAbsorptionSf`, row.quarterlyNetAbsorptionSf),
  }));
  const positive = absorption.filter((item) => item.value > 0);
  const negative = absorption.filter((item) => item.value < 0);
  const flat = total - positive.length - negative.length;
  breadth(
    "absorption_sign_counts",
    "Submarkets by absorption direction",
    positive.length,
    `${positive.length} of ${total} submarkets posted positive net absorption, ${negative.length} posted negative net absorption, and ${flat} were flat`,
    "Count of canonical submarkets by sign of quarterly net absorption",
    { editorialPriority: "lead" },
  );
  const grossPositive = positive.reduce((sum, item) => sum + item.value, 0);
  if (grossPositive > 0 && positive.length > 3) {
    const top = [...positive].sort((a, b) => b.value - a.value).slice(0, 3);
    const topShare = top.reduce((sum, item) => sum + item.value, 0) / grossPositive;
    breadth(
      "top3_absorption_share",
      "Top three submarkets' share of positive absorption",
      topShare,
      `${top.map((item) => name(item.row)).join(", ")} accounted for ${share(topShare)} of gross positive net absorption`,
      "Sum of the three largest positive submarket absorption totals ÷ sum of all positive submarket absorption",
      { materialityPercent: topShare * 100, entityNames: top.map((item) => name(item.row)) },
    );
  }
  const construction = submarkets.reduce((sum, row) => sum + row.underConstructionSf, 0);
  if (construction > 0) {
    const top = [...submarkets].sort((a, b) => b.underConstructionSf - a.underConstructionSf).slice(0, 3).filter((row) => row.underConstructionSf > 0);
    const topShare = top.reduce((sum, row) => sum + row.underConstructionSf, 0) / construction;
    breadth(
      "top3_construction_share",
      "Top three submarkets' share of construction",
      topShare,
      `${top.map(name).join(", ")} held ${share(topShare)} of space under construction`,
      "Sum of the three largest submarket under-construction totals ÷ total under-construction SF",
      { materialityPercent: topShare * 100, entityNames: top.map(name) },
    );
  }

  const vacancies = submarkets.map((row) => row.vacancyRate).sort((a, b) => a - b);
  const middle = Math.floor(vacancies.length / 2);
  const median = vacancies.length % 2 ? vacancies[middle]! : (vacancies[middle - 1]! + vacancies[middle]!) / 2;
  breadth("median_vacancy", "Median submarket vacancy", median, `Median submarket vacancy of ${percentage(median)}`, "Median of the 18 canonical submarket vacancy rates", { editorialPriority: "background" });
  const overallVacancy = report.overallMarket.vacancyRate;
  if (Number.isFinite(overallVacancy)) {
    const above = submarkets.filter((row) => row.vacancyRate > overallVacancy).length;
    const below = submarkets.filter((row) => row.vacancyRate < overallVacancy).length;
    breadth(
      "vacancy_vs_overall",
      "Submarkets above/below overall vacancy",
      above,
      `${above} submarkets had vacancy above the overall rate of ${percentage(overallVacancy)} and ${below} were below it`,
      "Count of canonical submarkets with vacancy above and below the overall market vacancy rate",
      { editorialPriority: "background" },
    );
  }

  // Direction counts need each submarket's current and prior quarter.
  const period = report.report.period;
  const directions = report.submarketDetails
    .map((detail) => {
      const index = detail.historicalPeriods.findIndex((item) => item.period === period);
      const current = index >= 0 ? detail.historicalPeriods[index] : undefined;
      const prior = index >= 0 ? detail.historicalPeriods[index + 1] : undefined;
      if (!current || !prior) return undefined;
      const direction = (now: number | null, before: number | null) => {
        if (now == null || before == null) return 0;
        const value = now - before;
        return value >= 0.0001 ? 1 : value <= -0.0001 ? -1 : 0;
      };
      return {
        vacancy: direction(current.vacancyRate, prior.vacancyRate),
        availability: direction(current.availabilityRate, prior.availabilityRate),
      };
    })
    .filter((item): item is { vacancy: number; availability: number } => Boolean(item));
  if (directions.length === report.submarketDetails.length && directions.length === total) {
    const count = (key: "vacancy" | "availability", sign: number) =>
      directions.filter((item) => item[key] === sign).length;
    breadth(
      "vacancy_direction_counts",
      "Submarkets by vacancy direction",
      count("vacancy", 1),
      `Vacancy rose in ${count("vacancy", 1)} submarkets, fell in ${count("vacancy", -1)}, and was unchanged in ${count("vacancy", 0)}`,
      "Count of canonical submarkets by sign of quarter-over-quarter vacancy change (±1 basis point)",
    );
    breadth(
      "availability_direction_counts",
      "Submarkets by availability direction",
      count("availability", 1),
      `Availability rose in ${count("availability", 1)} submarkets, fell in ${count("availability", -1)}, and was unchanged in ${count("availability", 0)}`,
      "Count of canonical submarkets by sign of quarter-over-quarter availability change (±1 basis point)",
    );
    const opposite = directions.filter((item) => item.vacancy !== 0 && item.availability !== 0 && item.vacancy !== item.availability).length;
    breadth(
      "vacancy_availability_divergence",
      "Submarkets where vacancy and availability moved in opposite directions",
      opposite,
      `Vacancy and availability moved in opposite directions in ${opposite} of ${total} submarkets`,
      "Count of canonical submarkets whose vacancy and availability QoQ changes have opposite signs",
      { editorialPriority: "background" },
    );
  }
  return entries;
}

// --- Editorial brief ---------------------------------------------------------

/** Core v3 publication rules, carried in context for the MCP generation path. */
export const NARRATIVE_EDITORIAL_RULES: readonly string[] = [
  NARRATIVE_PUBLICATION_STYLE,
  "Communicate a market thesis, not a metric summary. Lead with the dominant story.",
  "Explain why something changed only when a fact with causalSupport true supports the cause. Otherwise state the movement without an explanation.",
  "Evidence strength: confirmed may be stated as the cause; strong may be stated as the cause without overstating certainty; indicative or unspecified never becomes a cause. Never infer a cause from a metric's direction.",
  "Construction types are governed values: keep Partial-Spec and Expansion distinct, and do not label unclassified construction as speculative or built-to-suit.",
  "Do not mechanically repeat values the reader already sees (facts with a non-empty visibleOn list). Interpret them instead.",
  "Mention a transaction only when it materially explains the thesis. Never list the Top Leases or Top Sales tables.",
  "A leasing_conversion fact whose occupancy commences after the report period is not current absorption or vacancy.",
  "Do not predict or imply future performance unless a governed pipeline or commencement fact supports it.",
  "Do not force every topic into every market, and do not end with a summary or positioning sentence.",
  "Use only supplied display values. Never calculate, round differently, or invent numbers or names.",
  "No em dashes. Avoid formulaic openings, repeated 'while' contrasts, and words like 'underscoring', 'highlighting', 'reflecting'.",
];

const marketActivityLevel = (
  metrics: MarketMetrics | OverallMarketMetrics,
  current: HistoricalMarketPeriod | undefined,
  explanatoryCount: number,
): NarrativeEditorialBrief["marketActivity"] => {
  const inventory = metrics.inventorySf;
  if (!inventory) return "moderate";
  const leasingRatio = (current?.leasingActivitySf ?? 0) / inventory;
  const absorptionRatio = Math.abs(metrics.quarterlyNetAbsorptionSf) / inventory;
  const constructionRatio = metrics.underConstructionSf / inventory;
  let score = 0;
  if (leasingRatio >= 0.02) score += 2;
  else if (leasingRatio >= 0.0075) score += 1;
  if (absorptionRatio >= 0.005) score += 2;
  else if (absorptionRatio >= 0.002) score += 1;
  if (constructionRatio >= 0.01) score += 1;
  if (explanatoryCount >= 2) score += 1;
  return score >= 4 ? "active" : score >= 2 ? "moderate" : "quiet";
};

const causalCoverage = (facts: NarrativeContextFact[]): NarrativeCausalCoverage => {
  const has = (type: NarrativeAnalyticalType) =>
    facts.some((item) => item.analyticalType === type && item.causalSupport === true);
  const contributors = facts.some((item) => item.contextKey.startsWith("driver.absorption."));
  return {
    vacancy: has("vacancy_bridge") ? "governed_driver" : "movement_only",
    availability: has("availability_bridge") ? "governed_driver" : "movement_only",
    absorption: has("absorption_bridge")
      ? "governed_driver"
      : contributors
        ? "contributors_only"
        : "movement_only",
    leasingConversion: has("leasing_conversion") ? "governed_driver" : "none",
    pipeline: has("pipeline_change") ? "governed_driver" : "movement_only",
  };
};

// --- Assembly ----------------------------------------------------------------

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
  const provenancePrefix = overall ? "" : `submarketDetails.${identity!.canonicalName}.`;
  const records = overall
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
      };
  const contributors = overall
    ? report.absorptionContributors
    : (detail?.absorptionContributors ?? []);
  const currentPeriod = history.find((item) => item.period === report.report.period);
  const pageContext = narrativePageContext(reportInstance, marketId);

  const governed = governedExplanatoryFacts(
    overall ? report.explanatoryFacts : detail?.explanatoryFacts,
    report.report.period,
  );
  const governedEntities = new Map<string, NarrativeEvidenceStrength>();
  for (const item of governed)
    for (const name of item.entityNames ?? []) {
      const key = normalizedEntity(name);
      // Only a fact that licenses a cause can make a transaction material on
      // its own; a measured-only driver link counts as indicative.
      const strength: NarrativeEvidenceStrength = item.causalSupport
        ? (item.evidenceStrength ?? "unspecified")
        : "indicative";
      const existing = governedEntities.get(key);
      if (!existing || EVIDENCE_RANK[strength] > EVIDENCE_RANK[existing])
        governedEntities.set(key, strength);
    }
  const netAbsorption = resolvePresentationValue(
    report,
    `${prefix}.quarterlyNetAbsorptionSf`,
    metricRow.quarterlyNetAbsorptionSf,
  );
  const quarterSalesVolume = resolvePresentationValue(
    report,
    `${prefix}.salesVolume`,
    metricRow.salesVolume,
  );
  // An engine-supplied absorption bridge supersedes the local contributor
  // listing, so the same decomposition is never presented twice.
  const absorptionBridgeSupplied = governed.some(
    (item) => item.analyticalType === "absorption_bridge",
  );
  const suppliedBreadth = new Set(
    governed
      .filter((item) => item.analyticalType === "market_breadth" && item.driverType)
      .map((item) => item.driverType!),
  );
  const concentration = concentrationFacts(
    records.leases.filter((lease) => lease.isDealConfidential === false),
    currentPeriod?.leasingActivitySf ?? undefined,
  );
  const facts = [
    ...metricFacts(report, metricRow, history, prefix, { overall, pageContext }),
    ...(overall ? rankingFacts(report, pageContext) : []),
    ...(overall ? marketBreadthFacts(report, suppliedBreadth) : []),
    ...governed,
    ...(absorptionBridgeSupplied
      ? []
      : absorptionDriverFacts(report, marketId, contributors, netAbsorption, provenancePrefix)),
    ...transactionFacts(
      report,
      records,
      {
        overall,
        pageContext,
        quarterLeasingSf: currentPeriod?.leasingActivitySf ?? null,
        quarterSalesVolume: Number.isFinite(quarterSalesVolume) ? quarterSalesVolume : null,
        governedEntities,
      },
      provenancePrefix,
    ),
    ...countFacts(records),
    ...compositionFacts(records.construction, metricRow.speculativeShare),
    ...concentration,
  ];
  const editorialBrief: NarrativeEditorialBrief = {
    contextModelVersion: NARRATIVE_CONTEXT_MODEL_VERSION,
    pageContext,
    causalCoverage: causalCoverage(facts),
    editorialProfile: {
      ...NARRATIVE_PROMPT_PROFILES[overall ? "overall" : "submarket"],
    },
    marketActivity: marketActivityLevel(
      metricRow,
      currentPeriod,
      governed.filter((item) => NARRATIVE_EXPLANATORY_TYPES.has(item.analyticalType!)).length,
    ),
    rules: [...NARRATIVE_EDITORIAL_RULES],
  };
  // Broker interviews only apply to the quarter they were captured for, and
  // only publishable observations can reach this point. A market without
  // coverage (or a report without an upload) gets no brokerContext key at
  // all, so its context and contextHash are identical to the pre-feature
  // context.
  const brokerInterviews = reportInstance.brokerInterviews;
  const brokerContext =
    brokerInterviews && brokerInterviews.period === report.report.period
      ? brokerContextForMarket(brokerInterviews, marketId)
      : undefined;
  const base: Omit<NarrativeContext, "contextHash"> = {
    marketId,
    marketName,
    marketKind: overall ? "overall" : "submarket",
    period: report.report.period,
    promptVersion:
      NARRATIVE_PROMPT_PROFILES[overall ? "overall" : "submarket"].version,
    facts,
    editorialBrief,
    ...(brokerContext ? { brokerContext } : {}),
  };
  return { ...base, contextHash: hashNarrativeContext(base) };
}

/**
 * Client/MCP-facing context. The wire carries the frozen narrative-v2
 * promptVersion and promptProfile (the live MCP rejects anything else with
 * PROMPT_PROFILE_MISMATCH); Report Studio's v3 editorial profile, page
 * context and causal coverage ride in the additive `editorialBrief`. The
 * contextHash is the hash of the local v3 context, echoed back unchanged.
 */
export function publicNarrativeContext(
  context: NarrativeContext,
): PublicNarrativeContext {
  const kind = context.marketKind === "overall" ? "overall" : "submarket";
  const output = {
    ...context,
    promptVersion: transportPromptVersion(kind),
    outputContractVersion: NARRATIVE_OUTPUT_CONTRACT_VERSION,
    promptProfile: { ...NARRATIVE_TRANSPORT_PROMPT_PROFILES[kind] },
    facts: context.facts.map(({ internalSourceIds: _ids, ...item }) => item),
    ...(context.brokerContext
      ? { brokerContext: narrativeV2BrokerContextSchema.parse(context.brokerContext) }
      : {}),
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
