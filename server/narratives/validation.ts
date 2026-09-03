import { containsSalesforceIdToken } from "../../src/shared/salesforceIds.ts";
import {
  NARRATIVE_PROMPT_PROFILES,
  countNarrativeWords,
  type NarrativeContext,
  type NarrativeGenerationResult,
  type NarrativeQualityFlag,
} from "../../src/report-engine/narratives/schema.ts";

export interface NarrativeValidationIssue {
  severity: "warning" | "error";
  kind: "support" | "entity" | "numeric" | "length" | "identifier";
  message: string;
}

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

const knownEntity = (candidate: string, context: NarrativeContext) => {
  const normalized = candidate.toLocaleLowerCase();
  if (
    [
      "overall market",
      "chicago industrial",
      "industrial market",
      "market data",
      "report data service",
    ].some((value) => normalized.includes(value))
  ) return true;
  const allowed = [
    context.marketName,
    ...context.facts.flatMap((item) => item.entityNames ?? []),
  ].map((item) => item.toLocaleLowerCase());
  return allowed.some(
    (value) => value.includes(normalized) || normalized.includes(value),
  );
};

export function validateNarrativeResult(
  context: NarrativeContext,
  result: NarrativeGenerationResult,
) {
  const issues: NarrativeValidationIssue[] = [];
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

  const allowedNumbers = context.facts.flatMap((item) => numericTokens(item.displayValue));
  numericTokens(result.narrative).forEach((token) => {
    if (allowedNumbers.some((allowed) => closeEnough(token, allowed))) return;
    if (allowedNumbers.some((allowed) => plausiblyRounded(token, allowed)))
      issues.push({
        severity: "warning",
        kind: "numeric",
        message: `Generated numeric fact ${token.raw} may be a rounded form of trusted context and requires review.`,
      });
    else
      issues.push({
        severity: "error",
        kind: "numeric",
        message: `Generated numeric fact ${token.raw} is not supported by the trusted context.`,
      });
  });

  const entityCandidates = result.narrative.match(
    /\b[A-Z][A-Za-z&’'-]+(?:\s+[A-Z][A-Za-z&’'-]+){1,3}\b/g,
  ) ?? [];
  for (const candidate of entityCandidates)
    if (!knownEntity(candidate, context))
      issues.push({
        severity: "error",
        kind: "entity",
        message: `Named entity “${candidate}” is not present in the publication-safe context.`,
      });

  const flags = new Set<NarrativeQualityFlag>(result.qualityFlags);
  if (issues.some((issue) => issue.kind === "numeric" && issue.severity === "warning"))
    flags.add("numeric_validation_warning");
  if (issues.some((issue) => issue.kind === "entity" && issue.severity === "warning"))
    flags.add("entity_validation_warning");
  if (result.claims.some((claim) => claim.evidenceClass === "interpretive"))
    flags.add("interpretive_statement");
  return { issues, qualityFlags: [...flags] };
}
