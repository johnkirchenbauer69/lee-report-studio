import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import type { GovernedExplanatoryFact } from "../../../src/report-engine/schema/industrialMarketReport.ts";
import { isMarketExplanationCategory } from "./contributors.ts";
import { normalizeQuarterBounds } from "./salesforceNormalization.ts";

/**
 * Consumes Market Data Engine `market-explanation-v1` Contributor rows.
 *
 * The engine reuses the existing Market_Data_Contributor__c schema; no new
 * Salesforce field is required. Roles:
 *   Contributor_Category__c  one of the six "* Driver" categories below
 *   Narrative_Context__c     publication-safe explanatory sentence
 *   Calc_Notes__c            machine-readable versioned JSON evidence
 *   Calculation_Version__c   "market-explanation-v1"
 *   Rank_Basis__c, Metric_Value__c, Sort_Value__c, Rank__c, Display_*__c
 *
 * Report Studio never recalculates the engine's bridges, causes, evidence
 * strength or historical authority. It copies governed values, keeps the
 * engine's provenance, and fails safe: a recognized explanation row whose
 * Calc_Notes__c cannot be read as market-explanation-v1 JSON may still
 * state its measured change, but it is never treated as causal evidence.
 * Legacy rows (other categories, plain-text Calc Notes) are not touched.
 */
export const MARKET_EXPLANATION_VERSION = "market-explanation-v1";

const CATEGORY_TYPES: Record<
  string,
  { factType: GovernedExplanatoryFact["factType"]; metric: string }
> = {
  "vacancy increase driver": { factType: "vacancy_bridge", metric: "vacancy" },
  "vacancy reduction driver": { factType: "vacancy_bridge", metric: "vacancy" },
  "availability increase driver": { factType: "availability_bridge", metric: "availability" },
  "availability reduction driver": { factType: "availability_bridge", metric: "availability" },
  "pipeline start driver": { factType: "pipeline_change", metric: "construction" },
  "pipeline delivery driver": { factType: "pipeline_change", metric: "construction" },
};

const OVERALL_MARKET_LABELS = new Set(["overall market", "overall_market"]);
const EVIDENCE = new Set(["confirmed", "strong", "indicative"]);

const normalized = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase();

const text = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  const output = String(value).trim();
  return output ? output : undefined;
};

const finite = (value: unknown) => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const isOverallMarketContributor = (row: SalesforceRecord) =>
  OVERALL_MARKET_LABELS.has(normalized(row.Submarket__c));

/**
 * Parses Calc_Notes__c only for a recognized explanation row. Returns the
 * structured notes, or a diagnostic explaining why they cannot be trusted.
 */
export function parseExplanationCalcNotes(row: SalesforceRecord): {
  notes?: Record<string, unknown>;
  diagnostic?: string;
} {
  const declared = text(row.Calculation_Version__c);
  if (declared && declared !== MARKET_EXPLANATION_VERSION)
    return { diagnostic: `unsupported Calculation_Version__c ${declared}` };
  const raw = row.Calc_Notes__c;
  if (typeof raw !== "string" || !raw.trim())
    return { diagnostic: "structured evidence (Calc_Notes__c) is missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { diagnostic: "Calc_Notes__c is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { diagnostic: "Calc_Notes__c is not a JSON object" };
  const notes = parsed as Record<string, unknown>;
  if (notes.version !== MARKET_EXPLANATION_VERSION)
    return {
      diagnostic: `Calc_Notes__c version ${String(notes.version ?? "(missing)")} is not ${MARKET_EXPLANATION_VERSION}`,
    };
  return { notes };
}

const evidenceStrength = (
  value: unknown,
): GovernedExplanatoryFact["evidenceStrength"] => {
  const candidate = normalized(value);
  return EVIDENCE.has(candidate)
    ? (candidate as GovernedExplanatoryFact["evidenceStrength"])
    : "unspecified";
};

const stringList = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => text(item)).filter((item): item is string => Boolean(item))
    : undefined;

const availabilityMetadata = (notes: Record<string, unknown>) => {
  const metadata = {
    timingClassification: text(notes.timing_classification),
    availabilityEvent: text(notes.availability_event),
    marketingClassification: text(notes.marketing_classification),
    removalCause: text(notes.removal_cause),
    directChangeSf: finite(notes.direct_change_sf),
    subletChangeSf: finite(notes.sublet_change_sf),
    currentFutureAvailableSf: finite(notes.current_future_available_sf),
    currentAvailableNowSf: finite(notes.current_available_now_sf),
    currentUnknownTimingSf: finite(notes.current_unknown_timing_sf),
  };
  return Object.values(metadata).some((value) => value !== undefined)
    ? metadata
    : undefined;
};

export interface ExplanatoryContributorMapping {
  facts: GovernedExplanatoryFact[];
  /** Publication-safe diagnostics (no record identifiers). */
  diagnostics: string[];
}

/**
 * Maps the explanation rows among `rows`; every other row is ignored.
 * `scope` selects which governed materiality share applies.
 */
export function mapExplanatoryContributors(
  rows: SalesforceRecord[],
  scope: "submarket" | "overall" = "submarket",
): ExplanatoryContributorMapping {
  const facts: GovernedExplanatoryFact[] = [];
  const diagnostics: string[] = [];
  for (const row of rows) {
    if (!isMarketExplanationCategory(row.Contributor_Category__c)) continue;
    const kind = CATEGORY_TYPES[normalized(row.Contributor_Category__c)]!;
    if (row.Active_In_Run__c !== true || row.Included_In_Report__c !== true)
      continue;
    if (row.Narrative_Eligible__c === false) continue;
    if (row.Is_Deal_Confidential__c === true) continue;
    const category = text(row.Contributor_Category__c)!;
    const title =
      text(row.Display_Title__c) ??
      text(row.Property_Name__c) ??
      text(row.Source_Record_Name__c);
    const displayValue =
      text(row.Narrative_Context__c) ?? text(row.Display_Value__c);
    if (!title || !displayValue) {
      diagnostics.push(
        `${category} contributor skipped: no publication-safe title or narrative context.`,
      );
      continue;
    }
    const { notes, diagnostic } = parseExplanationCalcNotes(row);
    const base: GovernedExplanatoryFact = {
      factType: kind.factType,
      category,
      rankBasis: text(row.Rank_Basis__c),
      label: `${category}: ${title}`,
      displayValue,
      metric: kind.metric,
      value: finite(row.Metric_Value__c) ?? null,
      rank: finite(row.Rank__c),
      propertyName: title,
      address: text(row.Address__c),
      narrativeEligible: true,
      isConfidential:
        typeof row.Is_Deal_Confidential__c === "boolean"
          ? row.Is_Deal_Confidential__c
          : null,
    };
    if (!notes) {
      const message = `${category} contributor "${title}": ${diagnostic}; treated as a measured change only, not causal evidence.`;
      diagnostics.push(message);
      facts.push({
        ...base,
        explanationVersion: text(row.Calculation_Version__c),
        evidenceStrength: "unspecified",
        trusted: false,
        diagnostics: [message],
      });
      continue;
    }
    const share = finite(
      scope === "overall"
        ? notes.overall_change_share_percent
        : notes.market_change_share_percent,
    );
    facts.push({
      ...base,
      explanationVersion: MARKET_EXPLANATION_VERSION,
      driverType: text(notes.driver_type),
      evidenceStrength: evidenceStrength(notes.evidence_strength),
      metric: text(notes.metric) ?? kind.metric,
      priorValue: finite(notes.prior_sf) ?? null,
      currentValue: finite(notes.current_sf) ?? null,
      changeValue: finite(notes.change_sf) ?? null,
      materialityPercent: share ?? null,
      populationStatus: text(notes.population_status),
      submarketTransfer:
        typeof notes.submarket_transfer === "boolean"
          ? notes.submarket_transfer
          : undefined,
      brokerEffect: text(notes.broker_effect),
      constructionType: text(notes.construction_type),
      constructionTypeSource: text(notes.construction_type_source),
      pipelineEventSf: finite(notes.pipeline_event_sf) ?? null,
      evidenceCount: Array.isArray(notes.evidence_ids)
        ? notes.evidence_ids.length
        : undefined,
      availability: availabilityMetadata(notes),
      priorSnapshotProvenance: text(notes.prior_snapshot_provenance),
      priorSnapshotHash: text(notes.prior_snapshot_hash),
      comparisonWarnings: stringList(notes.comparison_warnings),
      trusted: true,
    });
  }
  return {
    facts: facts.sort(
      (left, right) =>
        String(left.category).localeCompare(String(right.category)) ||
        (left.rank ?? Number.MAX_SAFE_INTEGER) -
          (right.rank ?? Number.MAX_SAFE_INTEGER) ||
        left.label.localeCompare(right.label),
    ),
    diagnostics,
  };
}

/**
 * Overall Market explanation rows (Submarket__c = "Overall Market") for the
 * report quarter. These are scoped separately because the canonical
 * submarket scoping intentionally excludes non-submarket geographies.
 */
export function overallMarketExplanationRows(
  rows: SalesforceRecord[],
  periodLabel: string,
) {
  const period = normalizeQuarterBounds(periodLabel).label;
  return rows.filter((row) => {
    if (!isOverallMarketContributor(row)) return false;
    if (!isMarketExplanationCategory(row.Contributor_Category__c)) return false;
    if (row.Active_In_Run__c !== true || row.Included_In_Report__c !== true)
      return false;
    const label = text(row.Quarter_Label__c);
    if (!label) return false;
    try {
      return normalizeQuarterBounds(label).label === period;
    } catch {
      return false;
    }
  });
}
