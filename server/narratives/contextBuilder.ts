import { createHash } from "node:crypto";
import {
  containsSalesforceIdToken,
} from "../../src/shared/salesforceIds.ts";
import { sanitizePublicationEntity } from "../../src/shared/publicationEntitySafety.ts";
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
  const optionalMetric = (key: string, label: string, value: unknown, formatter: (available: number) => string, path: string) => {
    const available = typeof value === "number" && Number.isFinite(value) ? value : null;
    metric(key, label, available, available === null ? "Unavailable" : formatter(available), path);
  };
  optionalMetric("inventory", "Inventory", metrics.inventorySf, (value) => sf(value).replace(/^\+/, ""), `${prefix}.inventorySf`);
  optionalMetric("vacancy", "Vacancy rate", metrics.vacancyRate, percentage, `${prefix}.vacancyRate`);
  optionalMetric("availability", "Availability rate", metrics.availabilityRate, percentage, `${prefix}.availabilityRate`);
  optionalMetric("net_absorption", "Quarterly net absorption", metrics.quarterlyNetAbsorptionSf, sf, `${prefix}.quarterlyNetAbsorptionSf`);
  optionalMetric("asking_rent", "Asking net rent", metrics.askingNetRentPsf, (value) => `${value.toFixed(2)}/SF`, `${prefix}.askingNetRentPsf`);
  optionalMetric("under_construction", "Under construction", metrics.underConstructionSf, (value) => sf(value).replace(/^\+/, ""), `${prefix}.underConstructionSf`);
  optionalMetric("deliveries", "Quarterly deliveries", metrics.deliveredSf, (value) => sf(value).replace(/^\+/, ""), `${prefix}.deliveredSf`);
  optionalMetric("speculative_share", "Speculative share", metrics.speculativeShare, percentage, `${prefix}.speculativeShare`);
  optionalMetric("sales_volume", "Sales volume", metrics.salesVolume, dollars, `${prefix}.salesVolume`);

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
    const leasingActivityChange = previous.leasingActivitySf
      ? ((current.leasingActivitySf - previous.leasingActivitySf) / previous.leasingActivitySf) * 100
      : null;
    delta("leasing_activity.qoq_percent", "Leasing activity QoQ %", leasingActivityChange, leasingActivityChange == null ? "Unavailable" : changePercent(leasingActivityChange), "((current leasing activity SF - previous leasing activity SF) / previous leasing activity SF) × 100");
    delta("net_absorption.qoq_change_sf", "Net absorption QoQ", current.quarterlyNetAbsorptionSf - previous.quarterlyNetAbsorptionSf, sf(current.quarterlyNetAbsorptionSf - previous.quarterlyNetAbsorptionSf), "current quarterly net absorption SF - previous quarterly net absorption SF");
    const absorptionChange = previous.quarterlyNetAbsorptionSf
      ? ((current.quarterlyNetAbsorptionSf - previous.quarterlyNetAbsorptionSf) / Math.abs(previous.quarterlyNetAbsorptionSf)) * 100
      : null;
    delta("net_absorption.qoq_percent", "Net absorption QoQ %", absorptionChange, absorptionChange == null ? "Unavailable" : changePercent(absorptionChange), "((current net absorption - previous net absorption) / |previous net absorption|) × 100");
    const salesChange = previous.salesVolume && current.salesVolume != null
      ? ((current.salesVolume - previous.salesVolume) / previous.salesVolume) * 100
      : null;
    delta("sales_volume.qoq_percent", "Sales volume QoQ", salesChange, salesChange == null ? "Unavailable" : changePercent(salesChange), "((current sales volume - previous sales volume) / previous sales volume) × 100");
  }

  entries.push(...yoyFacts(current, history));
  entries.push(...ytdFacts(history));
  entries.push(...historicalContextFacts(history));
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
      }),
    );
  yoy("vacancy.yoy_bps", "Vacancy YoY", (current.vacancyRate - priorYear.vacancyRate) * 10_000, basisPoints((current.vacancyRate - priorYear.vacancyRate) * 10_000), `(vacancy ${current.period} - vacancy ${priorYear.period}) × 10,000`);
  yoy("availability.yoy_bps", "Availability YoY", (current.availabilityRate - priorYear.availabilityRate) * 10_000, basisPoints((current.availabilityRate - priorYear.availabilityRate) * 10_000), `(availability ${current.period} - availability ${priorYear.period}) × 10,000`);
  yoy("net_absorption.yoy_change_sf", "Net absorption YoY", current.quarterlyNetAbsorptionSf - priorYear.quarterlyNetAbsorptionSf, sf(current.quarterlyNetAbsorptionSf - priorYear.quarterlyNetAbsorptionSf), `net absorption ${current.period} - net absorption ${priorYear.period}`);
  yoy("leasing_activity.yoy_change_sf", "Leasing activity YoY", current.leasingActivitySf - priorYear.leasingActivitySf, sf(current.leasingActivitySf - priorYear.leasingActivitySf), `leasing activity ${current.period} - leasing activity ${priorYear.period}`);
  yoy("under_construction.yoy_change_sf", "Under construction YoY", current.underConstructionSf - priorYear.underConstructionSf, sf(current.underConstructionSf - priorYear.underConstructionSf), `under construction ${current.period} - under construction ${priorYear.period}`);
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
      }),
    );
  const sum = (values: (number | null | undefined)[]) =>
    values.every((value) => typeof value === "number" && Number.isFinite(value))
      ? (values as number[]).reduce((total, value) => total + value, 0)
      : null;
  const absorption = sum(yearQuarters.map((item) => item.quarterlyNetAbsorptionSf));
  if (absorption != null) ytd("net_absorption", `YTD net absorption (${currentPeriod.year})`, absorption, sf(absorption).replace(/^\+/, ""));
  const leasing = sum(yearQuarters.map((item) => item.leasingActivitySf));
  if (leasing != null) ytd("leasing_activity", `YTD leasing activity (${currentPeriod.year})`, leasing, sf(leasing).replace(/^\+/, ""));
  const deliveries = sum(yearQuarters.map((item) => item.deliveredSf));
  if (deliveries != null) ytd("deliveries", `YTD deliveries (${currentPeriod.year})`, deliveries, sf(deliveries).replace(/^\+/, ""));
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
      const format = unit === "rate" ? percentage : unit === "currency" ? dollars : (value: number) => sf(value).replace(/^\+/, "");
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

  const signStreak = (values: number[]) => {
    if (!values.length || values[0] === 0) return 0;
    const positive = values[0]! > 0;
    let count = 0;
    for (const value of values) {
      if (value === 0 || positive !== value > 0) break;
      count += 1;
    }
    return { count, positive };
  };
  const absorptionStreak = signStreak(history.map((item) => item.quarterlyNetAbsorptionSf));
  if (absorptionStreak && absorptionStreak.count >= 2)
    historical(
      "net_absorption.streak",
      `Net absorption ${absorptionStreak.positive ? "positive" : "negative"} streak`,
      absorptionStreak.count,
      `${absorptionStreak.count} consecutive quarters of ${absorptionStreak.positive ? "positive" : "negative"} net absorption`,
      `Count of consecutive quarters ending ${history[0]!.period} with ${absorptionStreak.positive ? "positive" : "negative"} net absorption`,
    );

  const directionalStreak = (accessor: (item: HistoricalMarketPeriod) => number, label: string, key: string) => {
    if (history.length < 2) return;
    let rising = 0;
    while (rising < history.length - 1 && accessor(history[rising]!) > accessor(history[rising + 1]!)) rising += 1;
    let falling = 0;
    while (falling < history.length - 1 && accessor(history[falling]!) < accessor(history[falling + 1]!)) falling += 1;
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
    return window.reduce((total, item) => total + item.quarterlyNetAbsorptionSf, 0) / count;
  };
  const average4 = average(4);
  if (average4 != null)
    historical("net_absorption.avg_4q", "4-quarter average net absorption", average4, sf(average4), "Average quarterly net absorption over the trailing 4 quarters (current quarter included)");
  const average8 = average(8);
  if (average8 != null)
    historical("net_absorption.avg_8q", "8-quarter average net absorption", average8, sf(average8), "Average quarterly net absorption over the trailing 8 quarters (current quarter included)");
  const priorFourAverage = average(4, 1);
  if (priorFourAverage != null && history[0])
    historical(
      "net_absorption.vs_prior_4q_avg",
      "Current quarter vs. recent average",
      history[0].quarterlyNetAbsorptionSf - priorFourAverage,
      `${history[0].quarterlyNetAbsorptionSf >= priorFourAverage ? "above" : "below"} the prior 4-quarter average by ${sf(Math.abs(history[0].quarterlyNetAbsorptionSf - priorFourAverage)).replace(/^\+/, "")}`,
      "Current quarterly net absorption minus the average of the 4 quarters preceding it",
    );

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
    });
  return [
    count("leases", "Lease count", records.leases.length),
    count("sales", "Sale count", records.sales.length),
    count("construction_projects", "Active construction project count", records.construction.length),
    count("deliveries", "Delivery count", records.deliveries.length),
    count("availabilities", "Availability count", records.availabilities.length),
  ];
};

/** Speculative vs. built-to-suit composition of the quarter's construction pipeline. */
const compositionFacts = (construction: PropertyHighlight[]): NarrativeContextFact[] => {
  if (!construction.length) return [];
  const isSpeculative = (item: PropertyHighlight) => /spec/i.test(item.type ?? item.constructionType ?? "");
  const isBts = (item: PropertyHighlight) => /built.?to.?suit|\bbts\b/i.test(item.type ?? item.constructionType ?? "");
  const totalSf = construction.reduce((total, item) => total + item.sizeSf, 0);
  if (!totalSf) return [];
  const specSf = construction.filter(isSpeculative).reduce((total, item) => total + item.sizeSf, 0);
  const btsSf = construction.filter(isBts).reduce((total, item) => total + item.sizeSf, 0);
  const specCount = construction.filter(isSpeculative).length;
  const btsCount = construction.filter(isBts).length;
  const composition = (
    key: string,
    label: string,
    value: number,
    displayValue: string,
    calculation: string,
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
    });
  return [
    composition("speculative_sf", "Speculative SF under construction", specSf, sf(specSf).replace(/^\+/, ""), "Sum of tracked under-construction SF flagged Speculative"),
    composition("bts_sf", "Built-to-suit SF under construction", btsSf, sf(btsSf).replace(/^\+/, ""), "Sum of tracked under-construction SF flagged Built-to-Suit"),
    composition("speculative_share", "Speculative share of tracked construction", specSf / totalSf, percentage(specSf / totalSf), "Speculative SF ÷ total tracked under-construction SF"),
    composition("bts_share", "Built-to-suit share of tracked construction", btsSf / totalSf, percentage(btsSf / totalSf), "Built-to-suit SF ÷ total tracked under-construction SF"),
    composition("project_counts", "Construction projects by type", specCount + btsCount, `${specCount} speculative · ${btsCount} built-to-suit`, "Count of tracked construction projects by type"),
  ];
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
  const entries: NarrativeContextFact[] = [
    fact({
      contextKey: "concentration.large_lease_count",
      category: "concentration",
      label: "500k SF+ lease count",
      value: large.length,
      displayValue: `${large.length}`,
      sourceType: "Market_Data_Contributor__c",
      authority: "Deterministic count of quarter-scoped lease records",
      calculation: "Count of tracked leases with size ≥ 500,000 SF",
      internalSourceIds: [],
    }),
    fact({
      contextKey: "concentration.large_lease_sf",
      category: "concentration",
      label: "SF from 500k SF+ leases",
      value: largeSf,
      displayValue: sf(largeSf).replace(/^\+/, ""),
      sourceType: "Market_Data_Contributor__c",
      authority: "Deterministic sum of quarter-scoped lease records",
      calculation: "Sum of tracked lease SF with size ≥ 500,000 SF",
      internalSourceIds: [],
    }),
  ];
  if (currentLeasingActivitySf)
    entries.push(
      fact({
        contextKey: "concentration.large_lease_share",
        category: "concentration",
        label: "Share of leasing volume from 500k SF+ leases",
        value: largeSf / currentLeasingActivitySf,
        displayValue: percentage(largeSf / currentLeasingActivitySf),
        sourceType: "Report_Data_Service",
        authority: "Deterministic application calculation",
        calculation: "SF from tracked leases ≥ 500,000 SF ÷ governed quarterly leasing activity SF",
        internalSourceIds: [],
      }),
    );
  return entries;
};

/**
 * Curated, deterministic explanation context (section E). Every driver here
 * is derived directly from governed records already present elsewhere in
 * context — never inferred from two merely-simultaneous facts.
 */
const marketDriverFacts = (
  metrics: MarketMetrics,
  history: HistoricalMarketPeriod[],
  rawPositiveContributors: AbsorptionContributor[],
  rawNegativeContributors: AbsorptionContributor[],
  construction: PropertyHighlight[],
  concentrationShare: number | null,
): NarrativeContextFact[] => {
  const entries: NarrativeContextFact[] = [];
  const sanitize = (list: AbsorptionContributor[]) =>
    [...list]
      .sort((a, b) => Math.abs(b.contributionSf) - Math.abs(a.contributionSf))
      .map((item) => ({ ...item, propertyName: safeText(item.propertyName) }))
      .filter((item) => item.propertyName);
  const positiveContributors = sanitize(rawPositiveContributors);
  const negativeContributors = sanitize(rawNegativeContributors);
  const driver = (
    key: string,
    label: string,
    displayValue: string,
    calculation: string,
    entityNames: string[] = [],
  ) =>
    entries.push(
      fact({
        contextKey: `market_driver.${key}`,
        category: "market_driver",
        label,
        value: displayValue,
        displayValue,
        sourceType: "Report_Data_Service",
        authority: "Deterministic synthesis of governed quarter records",
        calculation,
        internalSourceIds: [],
        entityNames,
      }),
    );

  const current = history[0];
  const previous = history[1];
  if (current && previous) {
    const vacancyRising = current.vacancyRate > previous.vacancyRate;
    if (vacancyRising && negativeContributors.length)
      driver(
        "vacancy_increase_second_generation_space",
        "Vacancy increase driver",
        `Vacancy increase is associated with second-generation space returning to the market, including ${negativeContributors[0]!.propertyName}`,
        "Vacancy rose QoQ while governed negative-absorption contributors exist for the quarter",
        negativeContributors.slice(0, 3).map((item) => item.propertyName),
      );
    const vacancyFalling = current.vacancyRate < previous.vacancyRate;
    if (vacancyFalling && positiveContributors.length)
      driver(
        "vacancy_decrease_tenant_occupancy",
        "Vacancy decrease driver",
        `Vacancy decrease is supported by major tenant occupancies, including ${positiveContributors[0]!.propertyName}`,
        "Vacancy fell QoQ while governed positive-absorption contributors exist for the quarter",
        positiveContributors.slice(0, 3).map((item) => item.propertyName),
      );
  }
  if (
    history[0] &&
    history[0].quarterlyNetAbsorptionSf > 0 &&
    positiveContributors.length
  )
    driver(
      "absorption_gain_move_ins",
      "Absorption gain driver",
      `Positive net absorption is tied to specific large move-ins, led by ${positiveContributors[0]!.propertyName}`,
      "Net absorption is positive and governed positive-absorption contributors exist for the quarter",
      positiveContributors.slice(0, 3).map((item) => item.propertyName),
    );
  if (
    history[0] &&
    history[0].quarterlyNetAbsorptionSf < 0 &&
    negativeContributors.length
  )
    driver(
      "absorption_loss_move_outs",
      "Absorption loss driver",
      `Negative net absorption is tied to a major move-out at ${negativeContributors[0]!.propertyName}`,
      "Net absorption is negative and governed negative-absorption contributors exist for the quarter",
      negativeContributors.slice(0, 3).map((item) => item.propertyName),
    );

  if (construction.length) {
    const specShare = metrics.speculativeShare;
    if (Number.isFinite(specShare) && specShare < 0.15)
      driver(
        "speculative_pipeline_limited",
        "Speculative pipeline driver",
        "The speculative development pipeline is limited relative to total tracked under-construction SF",
        "Speculative share of under-construction SF is below 15%",
      );
    const btsSf = construction
      .filter((item) => /built.?to.?suit|\bbts\b/i.test(item.type ?? item.constructionType ?? ""))
      .reduce((total, item) => total + item.sizeSf, 0);
    const totalSf = construction.reduce((total, item) => total + item.sizeSf, 0);
    if (totalSf && btsSf / totalSf > 0.65)
      driver(
        "deliveries_dominated_by_bts",
        "Construction composition driver",
        "The tracked construction pipeline is dominated by built-to-suit development rather than speculative supply",
        "Built-to-suit SF exceeds 65% of tracked under-construction SF",
      );
  }
  if (concentrationShare != null && concentrationShare > 0.4)
    driver(
      "leasing_concentration_large_leases",
      "Leasing concentration driver",
      `A large share of quarterly leasing volume is concentrated in leases of 500,000 SF or more (${percentage(concentrationShare)})`,
      "SF from tracked leases ≥ 500,000 SF exceeds 40% of governed quarterly leasing activity",
    );
  return entries;
};

const safeText = (value: unknown) => {
  const output = sanitizeNarrativeDataString(value);
  if (containsSalesforceIdToken(output)) return "";
  return sanitizePublicationEntity(output);
};

/** Parses a "YYYY Qn" governed period label. Returns null for anything else. */
const parsePeriod = (period: string): { year: number; quarter: number } | null => {
  const match = /^(\d{4})\s*Q([1-4])$/.exec(period.trim());
  if (!match) return null;
  return { year: Number(match[1]), quarter: Number(match[2]) };
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
          displayValue: `${safeText(row.name)} · ${sf(row.leasingActivitySf).replace(/^\+/, "")}`,
          sourceType: "Market_Data__c",
          authority: "Deterministic ranking of the 18 canonical submarkets",
          calculation: `Sort canonical submarkets by current-quarter leasing activity SF ${direction === "leader" ? "descending" : "ascending"}`,
          internalSourceIds: [],
          entityNames: [safeText(row.name)],
        })),
      ),
    );
  }
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
  const positiveContributors = contributors.filter((item) => item.direction === "positive");
  const negativeContributors = contributors.filter((item) => item.direction === "negative");
  const currentLeasingActivitySf = history.find(
    (item) => item.period === report.report.period,
  )?.leasingActivitySf;
  const concentration = concentrationFacts(records.leases.filter((lease) => lease.isDealConfidential === false), currentLeasingActivitySf);
  const concentrationShare = concentration.find(
    (item) => item.contextKey === "concentration.large_lease_share",
  )?.value;
  const facts = [
    ...metricFacts(report, metricRow, history, prefix),
    ...(overall ? rankingFacts(report) : []),
    ...absorptionDriverFacts(report, marketId, contributors, provenancePrefix),
    ...transactionFacts(report, records, provenancePrefix),
    ...countFacts(records),
    ...compositionFacts(records.construction),
    ...concentration,
    ...marketDriverFacts(
      metricRow,
      history,
      positiveContributors,
      negativeContributors,
      records.construction,
      typeof concentrationShare === "number" ? concentrationShare : null,
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
