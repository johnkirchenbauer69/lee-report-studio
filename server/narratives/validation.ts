import { containsSalesforceIdToken } from "../../src/shared/salesforceIds.ts";
import {
  NARRATIVE_PROMPT_PROFILES,
  countNarrativeWords,
  type NarrativeContext,
  type NarrativeGenerationResult,
  type NarrativeQualityFlag,
  type NarrativeValidationWarning,
} from "../../src/report-engine/narratives/schema.ts";

export interface NarrativeValidationIssue {
  severity: "warning" | "error";
  kind: "support" | "entity" | "numeric" | "length" | "identifier" | "workflow" | "formatting" | "style";
  message: string;
  /**
   * Provenance for entity-grounding decisions (kind: "entity"): the
   * extraction span, resolution method, and canonical governed entity
   * matched, if any. Debug/test detail — never required for the UI.
   */
  entityProvenance?: {
    span: string;
    resolutionMethod: EntityResolutionMethod;
    canonicalEntity?: string;
  };
}

// Deterministic publication-style rule: the model may not use the Unicode
// em dash character, full stop. This is an exact character check, not a
// punctuation-inference regex, so it never touches ordinary hyphens
// (year-over-year, build-to-suit, 500,000-square-foot) or negative numbers
// (-20,000 SF).
const EM_DASH = "—";

// Internal workflow / provenance language that must never reach publication
// copy, regardless of how it got into the model's output.
const INTERNAL_WORKFLOW_PATTERNS: RegExp[] = [
  /\bwaiting for comp\b/i,
  /\bsupplied transaction\b/i,
  /\bsupplied absorption contributor\b/i,
  /\bfinalist\b/i,
  /\bsalesforce\b/i,
  /\bascendix\b/i,
  /\bsupport key(?:s)?\b/i,
  /\bprovenance\b/i,
  /\bcontext ?hash\b/i,
  /\bcontext key(?:s)?\b/i,
  /\binternal note\b/i,
  /\banalyst note\b/i,
];

const MARKDOWN_FORMATTING_PATTERNS: RegExp[] = [
  /^\s*[-*•]\s+/m,
  /^\s{0,3}#{1,6}\s/m,
];

// Openings this codebase never wants to see, whether they name the market
// directly or just lead with a bare metric.
const METRIC_LEAD_WORDS = [
  "Vacancy",
  "Availability",
  "Net absorption",
  "Quarterly leasing activity",
  "Leasing activity",
  "Sales volume",
  "Inventory",
  "The submarket",
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const splitSentences = (text: string) =>
  text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const startsWithTemplateOpening = (narrative: string, marketName: string) => {
  const trimmed = narrative.trim();
  const marketPattern = new RegExp(
    `^(?:the\\s+)?${escapeRegExp(marketName)}\\s+(ended|closed|finished)\\b`,
    "i",
  );
  if (marketPattern.test(trimmed)) return true;
  return METRIC_LEAD_WORDS.some((word) =>
    new RegExp(`^${escapeRegExp(word)}\\b`, "i").test(trimmed),
  );
};

const leadCategory = (sentence: string) =>
  METRIC_LEAD_WORDS.find((word) => new RegExp(`^${escapeRegExp(word)}\\b`, "i").test(sentence.trim()));

const BOILERPLATE_PHRASES = [
  "the submarket also had",
  "sales volume totaled",
  "quarterly leasing activity totaled",
  "net absorption totaled",
  "vacancy finished the quarter at",
];

const COMPARATIVE_LANGUAGE = /\b(compared|from the prior|from a year|year[- ]over[- ]year|quarter[- ]over[- ]quarter|up from|down from|increased|decreased|accelerat|decelerat|rose|fell|rising|falling|improved|worsened|higher than|lower than|widened|narrowed|streak|consecutive|reversal|reversed|outpac|trailing|average)\b/i;

interface NumericToken {
  kind: "percent" | "bps" | "sf" | "currency";
  value: number;
  raw: string;
}

const numericTokens = (text: string): NumericToken[] => {
  const tokens: NumericToken[] = [];
  const add = (
    expression: RegExp,
    kind: NumericToken["kind"],
    convert: (match: RegExpExecArray) => number,
  ) => {
    for (const match of text.matchAll(expression))
      tokens.push({ kind, value: convert(match), raw: match[0] });
  };
  add(/\b(\d+(?:\.\d+)?)\s*%/gi, "percent", (match) => Number(match[1]));
  add(/\b(\d+(?:\.\d+)?)\s*(?:basis points|bps)\b/gi, "bps", (match) => Number(match[1]));
  add(/\b(\d[\d,]*(?:\.\d+)?)\s*(million|m)?\s*(?:SF|square feet)\b/gi, "sf", (match) => Number(match[1]!.replace(/,/g, "")) * (match[2] ? 1_000_000 : 1));
  add(/\$(\d[\d,]*(?:\.\d+)?)\s*(million|m)?\b/gi, "currency", (match) => Number(match[1]!.replace(/,/g, "")) * (match[2] ? 1_000_000 : 1));
  return tokens;
};

const closeEnough = (left: NumericToken, right: NumericToken) => {
  if (left.kind !== right.kind) return false;
  const tolerance =
    left.kind === "percent" ? 0.11 : left.kind === "bps" ? 1 : Math.max(1, Math.abs(right.value) * 0.055);
  return Math.abs(Math.abs(left.value) - Math.abs(right.value)) <= tolerance;
};

const plausiblyRounded = (left: NumericToken, right: NumericToken) => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "percent")
    return Math.abs(Math.abs(left.value) - Math.abs(right.value)) <= 0.5;
  if (left.kind === "bps")
    return Math.abs(Math.abs(left.value) - Math.abs(right.value)) <= 5;
  return (
    Math.abs(Math.abs(left.value) - Math.abs(right.value)) <=
    Math.max(1, Math.abs(right.value) * 0.15)
  );
};

// Generic descriptive phrases that are not really "named entities" needing
// grounding — safe to treat as always-known regardless of context.
const GENERIC_ENTITY_TERMS = [
  "overall market",
  "chicago industrial",
  "industrial market",
  "market data",
  "report data service",
];

// Curly/typographic apostrophe and backtick variants, normalized to a
// single straight apostrophe before possessive stripping so "Hyundai
// Translead's" and "Hyundai Translead’s" compare identically.
const APOSTROPHE_VARIANTS = /[‘’‛ʼ`´]/g;

/**
 * Conservative entity-name normalization for grounding comparison ONLY.
 * This never changes what is stored or displayed — it exists purely so the
 * validator can tell "Hyundai Translead's" and "Hyundai Translead" apart
 * from a genuinely different entity, instead of hard-rejecting a possessive
 * or a punctuation variant.
 *
 * Rules (deliberately narrow — this is not general fuzzy matching):
 *  - unify curly/backtick apostrophes to a straight apostrophe
 *  - strip a trailing possessive ('s or bare trailing ' as in "Prologis'")
 *  - strip leading/trailing punctuation and quote characters
 *  - collapse repeated whitespace
 *  - case-fold
 */
export const normalizeEntityForMatch = (raw: string): string => {
  let value = raw.replace(APOSTROPHE_VARIANTS, "'");
  value = value.trim();
  value = value.replace(/^["'“”.,;:!?()]+/, "").replace(/["'“”.,;:!?()]+$/, "");
  // Trailing possessive: "Hyundai Translead's" -> "Hyundai Translead";
  // "Prologis'" -> "Prologis".
  value = value.replace(/'s$/i, "").replace(/'$/, "");
  value = value.replace(/\s+/g, " ").trim();
  return value.toLocaleLowerCase();
};

/**
 * Resolution method taxonomy for governed-entity matching. Only
 * "unsupported_entity" and "ambiguous_entity" are meant to surface as
 * user-facing review warnings; the rest are provenance/debug detail that
 * explains *why* a candidate was accepted without a warning.
 */
export type EntityResolutionMethod =
  | "exact_match"
  | "normalization_match"
  | "contained_entity_component"
  | "structured_entity_match"
  | "alias_match"
  | "generic_term"
  | "unsupported_entity";

interface EntityMatchResult {
  matched: boolean;
  normalizedCandidate: string;
  resolutionMethod: EntityResolutionMethod;
  /** The governed value the candidate resolved against, when matched. */
  canonicalEntity?: string;
}

/**
 * Alias handling: market identity (canonical name, display name, and known
 * aliases like "I-80/Joliet Area" vs "I-80/Joliet") is already resolved
 * upstream in contextBuilder.ts / submarkets.ts before context.marketName
 * reaches here. The only aliases handled at this layer are explicit,
 * deterministic, typed company aliases — never inferred by similarity.
 */
const KNOWN_ENTITY_ALIASES: [string, string][] = [
  ["central national-gottesman", "cng"],
];

// A narrated market name is routinely prefixed with a leading definite
// article ("The I-55 Corridor closed…") that never appears in the governed
// marketName itself. This is ordinary English grammar, not a naming
// variation, so it is stripped before comparison — narrowly, and only as a
// leading token, not general fuzzy trimming.
const stripLeadingArticle = (value: string) => value.replace(/^the\s+/, "");

// Deterministic, conservative street-suffix equivalences. This is a fixed
// typed table, not general fuzzy matching, and only ever canonicalizes a
// whole whitespace-delimited token to its abbreviated spelling so "Road"
// and "Rd" compare equal without touching any other word.
const STREET_SUFFIX_PAIRS: [string, string][] = [
  ["road", "rd"],
  ["street", "st"],
  ["avenue", "ave"],
  ["drive", "dr"],
  ["boulevard", "blvd"],
  ["parkway", "pkwy"],
  ["highway", "hwy"],
  ["route", "rt"],
];
const STREET_SUFFIX_TOKENS = new Set(STREET_SUFFIX_PAIRS.flat());
const STREET_SUFFIX_CANONICAL = new Map(STREET_SUFFIX_PAIRS);

const canonicalizeStreetSuffixes = (value: string): string =>
  value
    .split(" ")
    .map((token) => STREET_SUFFIX_CANONICAL.get(token) ?? token)
    .join(" ");

/**
 * A candidate/allowed value "looks address-like" when it starts with a
 * street number or contains a recognized street-suffix token. This gates
 * the containment-match path (below) so it can only ever resolve address
 * fragments against governed addresses — it must never let, for example, a
 * bare city name substring-match inside an unrelated company name.
 */
const looksAddressLike = (normalized: string): boolean =>
  /^\d/.test(normalized) ||
  normalized.split(" ").some((token) => STREET_SUFFIX_TOKENS.has(token));

const matchesAlias = (a: string, b: string): boolean =>
  KNOWN_ENTITY_ALIASES.some(
    ([left, right]) => (a === left && b === right) || (a === right && b === left),
  );

/**
 * Governed-entity resolution hierarchy for narrative entity grounding:
 *   1. exact canonical match
 *   2. normalized match (case/punctuation/whitespace/possessive, plus
 *      conservative street-suffix equivalence)
 *   3. containment: a deterministically address-like extracted fragment
 *      (e.g. "Youngs Rd") that occurs, word-bounded, inside a governed full
 *      address occurrence (e.g. "3835 Youngs Rd") resolves to that parent
 *      entity instead of warning
 *   4. explicit typed alias table
 *   5. unsupported — kept as a review warning
 *
 * `context.facts[].entityNames` already carries the individual typed
 * governed source field values that produced each fact (tenant, address,
 * buyer, developer, submarket name, project name — see contextBuilder.ts),
 * not one flattened blob, so this already resolves against the structured
 * source fields rather than a lossy flattened string.
 */
const matchEntity = (candidate: string, context: NarrativeContext): EntityMatchResult => {
  const normalizedCandidate = normalizeEntityForMatch(candidate);
  if (GENERIC_ENTITY_TERMS.some((term) => normalizedCandidate.includes(term)))
    return { matched: true, normalizedCandidate, resolutionMethod: "generic_term" };
  const candidateVariants = new Set([
    normalizedCandidate,
    stripLeadingArticle(normalizedCandidate),
  ]);
  const allowedRaw = [
    context.marketName,
    ...context.facts.flatMap((item) => item.entityNames ?? []),
  ];
  const allowedNormalized = allowedRaw.map((value) => ({
    raw: value,
    normalized: normalizeEntityForMatch(value),
  }));

  // 1/2. Exact + normalized (case, punctuation, whitespace, possessive).
  const exact = allowedNormalized.find((entry) =>
    candidateVariants.has(entry.normalized),
  );
  if (exact)
    return {
      matched: true,
      normalizedCandidate,
      resolutionMethod:
        exact.normalized === normalizedCandidate ? "exact_match" : "normalization_match",
      canonicalEntity: exact.raw,
    };

  // 2b. Street-suffix equivalence (Road/Rd, Street/St, …), still an exact
  // token-for-token comparison after canonicalization — not fuzzy matching.
  const candidateSuffixNorm = canonicalizeStreetSuffixes(normalizedCandidate);
  const suffixMatch = allowedNormalized.find(
    (entry) => canonicalizeStreetSuffixes(entry.normalized) === candidateSuffixNorm,
  );
  if (suffixMatch)
    return {
      matched: true,
      normalizedCandidate,
      resolutionMethod: "normalization_match",
      canonicalEntity: suffixMatch.raw,
    };

  // 3. Governed containment: an address-like fragment that is a word-bounded
  // component of a governed address-like full entity. Restricted to
  // address-like values on both sides so this can never let an unrelated
  // entity type (e.g. a city name) substring-match inside a company name.
  if (looksAddressLike(candidateSuffixNorm)) {
    const candidatePattern = new RegExp(`\\b${escapeRegExp(candidateSuffixNorm)}\\b`);
    const contained = allowedNormalized.find((entry) => {
      if (!looksAddressLike(entry.normalized)) return false;
      const canonicalAllowed = canonicalizeStreetSuffixes(entry.normalized);
      return candidatePattern.test(canonicalAllowed);
    });
    if (contained)
      return {
        matched: true,
        normalizedCandidate,
        resolutionMethod: "contained_entity_component",
        canonicalEntity: contained.raw,
      };
  }

  // 4. Explicit typed alias table.
  const aliasMatch = allowedNormalized.find((entry) =>
    matchesAlias(normalizedCandidate, entry.normalized),
  );
  if (aliasMatch)
    return {
      matched: true,
      normalizedCandidate,
      resolutionMethod: "alias_match",
      canonicalEntity: aliasMatch.raw,
    };

  return { matched: false, normalizedCandidate, resolutionMethod: "unsupported_entity" };
};

export function validateNarrativeResult(
  context: NarrativeContext,
  result: NarrativeGenerationResult,
) {
  const issues: NarrativeValidationIssue[] = [];
  const warnings: NarrativeValidationWarning[] = [];
  const keys = new Set(context.facts.map((item) => item.contextKey));
  for (const key of [
    ...result.contextKeysUsed,
    ...result.claims.flatMap((claim) => claim.supportKeys),
  ])
    if (!keys.has(key))
      issues.push({
        severity: "error",
        kind: "support",
        message: `Generated support key ${key} is not present in the trusted context.`,
      });
  result.claims.forEach((claim) => {
    if (!claim.supportKeys.length)
      issues.push({
        severity: "error",
        kind: "support",
        message: `Claim “${claim.claim.slice(0, 80)}” has no supporting context.`,
      });
  });

  const profile =
    NARRATIVE_PROMPT_PROFILES[
      context.marketKind === "overall" ? "overall" : "submarket"
    ];
  const words = countNarrativeWords(result.narrative);
  if (words > profile.hardMaxWords)
    issues.push({
      severity: "error",
      kind: "length",
      message: `Narrative contains ${words} words; the hard maximum is ${profile.hardMaxWords}.`,
    });

  const clientFacing = {
    narrative: result.narrative,
    claims: result.claims,
    contextKeysUsed: result.contextKeysUsed,
  };
  const containsId = (value: unknown): boolean => {
    if (typeof value === "string") return containsSalesforceIdToken(value);
    if (Array.isArray(value)) return value.some(containsId);
    return Boolean(
      value &&
        typeof value === "object" &&
        Object.values(value as Record<string, unknown>).some(containsId),
    );
  };
  if (containsId(clientFacing))
    issues.push({
      severity: "error",
      kind: "identifier",
      message: "Generated output contains a raw Salesforce record identifier.",
    });

  // Numeric grounding is advisory, not a hard blocker: format/phrasing
  // differences ("$14.50/SF" vs "$14.50 per square foot"), unit
  // restatements ("1.2 million SF" vs "1,200,000 SF"), and rounding are all
  // things a reviewer can evaluate against the visible governed context in
  // seconds. A number that cannot be matched at all is still worth flagging
  // for review — it just should not silently reject a professionally usable
  // draft (and the whole batch it shipped in) on its own. Hard rejection is
  // reserved for integrity-level problems (unsupported support keys,
  // corrupted payload, stale/version mismatch), handled elsewhere in this
  // function.
  const allowedNumbers = context.facts.flatMap((item) => numericTokens(item.displayValue));
  numericTokens(result.narrative).forEach((token) => {
    if (allowedNumbers.some((allowed) => closeEnough(token, allowed))) return;
    const rounded = allowedNumbers.some((allowed) => plausiblyRounded(token, allowed));
    const message = rounded
      ? `Generated numeric fact ${token.raw} may be a rounded form of trusted context and requires review.`
      : `Generated numeric fact ${token.raw} could not be matched exactly to a governed display value and requires review.`;
    issues.push({ severity: "warning", kind: "numeric", message });
    warnings.push({ flag: "numeric_validation_warning", phrase: token.raw, message });
  });

  // Digits and slashes are part of real market names — I-55 Corridor,
  // I-80/Joliet Area. Excluding them truncates "I-55" to "I-" and reports the
  // fragment as an unsupported entity.
  //
  // Entity grounding is advisory, not a hard blocker (see matchEntity /
  // normalizeEntityForMatch above): once conservative normalization (case,
  // whitespace, punctuation, possessive form) is applied, anything that
  // still does not match exactly is surfaced as a review warning rather
  // than rejected outright. A human reviewer can evaluate a naming
  // variation, alias, or genuinely ungrounded mention against the visible
  // narrative and governed context far more reliably than a substring
  // heuristic can, and this must never silently reject a real 19-market
  // batch over one possessive or a plausible paraphrase.
  const wordCandidates = result.narrative.match(
    /\b[A-Z][A-Za-z0-9&’'/-]+(?:\s+[A-Z][A-Za-z0-9&’'/-]+){1,3}\b/g,
  ) ?? [];
  // Street-address candidates ("1401 S Kirk Rd", "3835 Youngs Rd") begin
  // with a house number, so the capitalized-word regex above never extracts
  // them as a whole span — it can only ever see the street-name tail. This
  // additive pattern extracts the full numeric address span so a subtly
  // wrong claim (e.g. the wrong directional prefix) is still checked as its
  // own candidate rather than only ever being checked as an already-safe
  // bare street-name fragment. It is deliberately narrow: the house number
  // must not be part of a larger number (no comma/digit/hyphen just before
  // it — this excludes "400,000 SF" and "I-88 Corridor"), and the span must
  // end in a recognized street-suffix word, so it can never match a bare
  // "<number> <Capitalized word>" pair like a year or a metric figure.
  const addressCandidates = result.narrative.match(
    /(?<![\d,-])\b\d[\d-]*\s+(?:[NSEW]\.?\s+)?[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z0-9.]*){0,2}\s+(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Blvd|Boulevard|Pkwy|Parkway|Hwy|Highway|Rt|Route|Way|Ln|Lane|Ct|Court|Pl|Place|Cir|Circle)\b/g,
  ) ?? [];
  const entityCandidates = [...new Set([...wordCandidates, ...addressCandidates])];
  for (const candidate of entityCandidates) {
    const resolution = matchEntity(candidate, context);
    if (resolution.matched) continue;
    const message = `Named entity “${candidate}” could not be traced to governed publication-safe evidence and requires review.`;
    issues.push({
      severity: "warning",
      kind: "entity",
      message,
      entityProvenance: {
        span: candidate,
        resolutionMethod: resolution.resolutionMethod,
      },
    });
    warnings.push({ flag: "entity_validation_warning", phrase: candidate, message });
  }

  for (const pattern of INTERNAL_WORKFLOW_PATTERNS) {
    const match = pattern.exec(result.narrative);
    if (match)
      issues.push({
        severity: "error",
        kind: "workflow",
        message: `Generated narrative contains internal workflow language ("${match[0]}"), which must never reach publication copy.`,
      });
  }
  if (MARKDOWN_FORMATTING_PATTERNS.some((pattern) => pattern.test(result.narrative)))
    issues.push({
      severity: "error",
      kind: "formatting",
      message: "Generated narrative uses bullets or headings; publication prose must be plain paragraphs.",
    });
  if (result.narrative.includes(EM_DASH))
    issues.push({
      severity: "error",
      kind: "style",
      message: "Generated narrative uses an em dash; publication prose must use commas, semicolons, colons, or separate sentences instead.",
    });

  const flags = new Set<NarrativeQualityFlag>(result.qualityFlags);
  if (issues.some((issue) => issue.kind === "numeric" && issue.severity === "warning"))
    flags.add("numeric_validation_warning");
  if (issues.some((issue) => issue.kind === "entity" && issue.severity === "warning"))
    flags.add("entity_validation_warning");
  if (result.claims.some((claim) => claim.evidenceClass === "interpretive"))
    flags.add("interpretive_statement");

  // --- Pragmatic editorial QA heuristics (non-blocking) --------------------
  // These never add to `issues`: stylistically varied prose should not be
  // rejected, but the batch/editor view should still see the signal.
  const sentences = splitSentences(result.narrative);
  if (startsWithTemplateOpening(result.narrative, context.marketName))
    flags.add("template_opening");

  if (sentences.length >= 3) {
    let longestRun = 1;
    let currentRun = 1;
    for (let index = 1; index < sentences.length; index++) {
      const previousLead = leadCategory(sentences[index - 1]!);
      const currentLead = leadCategory(sentences[index]!);
      currentRun = previousLead && currentLead ? currentRun + 1 : 1;
      longestRun = Math.max(longestRun, currentRun);
    }
    if (longestRun >= 3) flags.add("repetitive_sentence_structure");

    const metricLeadCount = sentences.filter((sentence) => leadCategory(sentence)).length;
    if (metricLeadCount / sentences.length > 0.5) flags.add("metric_dump");
  }

  const boilerplateHits = BOILERPLATE_PHRASES.reduce((total, phrase) => {
    const matches = result.narrative.match(
      new RegExp(escapeRegExp(phrase), "gi"),
    );
    return total + (matches?.length ?? 0);
  }, 0);
  if (boilerplateHits >= 2) flags.add("boilerplate_phrasing");

  const hasComparativeHistory = context.facts.some((item) =>
    (item.category === "trend" || item.category === "historical") &&
    (item.contextKey.includes(".yoy") ||
      item.contextKey.includes(".qoq") ||
      item.contextKey.startsWith("historical.")),
  );
  if (hasComparativeHistory && !COMPARATIVE_LANGUAGE.test(result.narrative))
    flags.add("missing_comparative_context");

  return { issues, qualityFlags: [...flags], warnings };
}

/**
 * Batch-level companion to startsWithTemplateOpening: flags every market
 * whose opening words recur across enough markets in the same generation
 * batch to read as a template, even when no single narrative matches a
 * banned pattern on its own. Non-blocking — callers merge this into
 * qualityFlags, they never turn it into a validation error.
 */
export function detectRepeatedBatchOpenings(
  narratives: { marketId: string; text: string }[],
  minimumOccurrences = 3,
): Set<string> {
  const openingWords = (text: string) =>
    text.trim().split(/\s+/).slice(0, 4).join(" ").toLocaleLowerCase();
  const counts = new Map<string, string[]>();
  for (const { marketId, text } of narratives) {
    if (!text.trim()) continue;
    const key = openingWords(text);
    counts.set(key, [...(counts.get(key) ?? []), marketId]);
  }
  const flagged = new Set<string>();
  for (const marketIds of counts.values())
    if (marketIds.length >= minimumOccurrences)
      for (const marketId of marketIds) flagged.add(marketId);
  return flagged;
}
