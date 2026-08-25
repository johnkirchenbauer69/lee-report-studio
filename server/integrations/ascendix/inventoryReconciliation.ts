export type InventoryReconciliationClassification =
  "matched" | "known-difference" | "warning" | "blocking";

export interface InventoryReconciliationResult {
  classification: InventoryReconciliationClassification;
  authoritativeValue: number | null;
  comparisonValue: number | null;
  varianceAbsolute: number | null;
  variancePercentage: number | null;
  reason: string;
  message: string;
}

const MATCH_ABSOLUTE_TOLERANCE_SF = 1;
const MATCH_RELATIVE_TOLERANCE = 0.000001;
const BLOCKING_ABSOLUTE_VARIANCE_SF = 1_000_000;
const BLOCKING_RELATIVE_VARIANCE = 0.005;
const HARD_RELATIVE_VARIANCE = 0.05;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const formatSf = (value: number) => Math.round(value).toLocaleString("en-US");

const formatPct = (value: number) => `${(value * 100).toFixed(4)}%`;

export function classifyInventoryReconciliation(input: {
  authoritativeInventory: unknown;
  propertyDataInventory: unknown;
  knownDifference?: boolean;
  knownDifferenceReason?: string;
}): InventoryReconciliationResult {
  const authoritativeValue = finite(input.authoritativeInventory)
    ? input.authoritativeInventory
    : null;
  const comparisonValue = finite(input.propertyDataInventory)
    ? input.propertyDataInventory
    : null;

  if (authoritativeValue === null || authoritativeValue <= 0)
    return {
      classification: "blocking",
      authoritativeValue,
      comparisonValue,
      varianceAbsolute: null,
      variancePercentage: null,
      reason: "Authoritative Market_Data inventory is missing or invalid.",
      message:
        "Authoritative Market_Data inventory is missing or invalid; publication is blocked.",
    };
  if (comparisonValue === null || comparisonValue < 0)
    return {
      classification: "blocking",
      authoritativeValue,
      comparisonValue,
      varianceAbsolute: null,
      variancePercentage: null,
      reason: "Property_Data inventory cross-check is invalid or non-finite.",
      message:
        "Property_Data inventory cross-check is invalid; official Market_Data remains selected and publication is blocked.",
    };

  const varianceAbsolute = Math.abs(comparisonValue - authoritativeValue);
  const variancePercentage = varianceAbsolute / authoritativeValue;
  if (
    varianceAbsolute <= MATCH_ABSOLUTE_TOLERANCE_SF ||
    variancePercentage <= MATCH_RELATIVE_TOLERANCE
  )
    return {
      classification: "matched",
      authoritativeValue,
      comparisonValue,
      varianceAbsolute,
      variancePercentage,
      reason: "Property_Data inventory reconciles within match tolerance.",
      message: "Property_Data inventory reconciles within tolerance.",
    };

  const detail =
    `Authoritative Market_Data: ${formatSf(authoritativeValue)} SF; ` +
    `Property_Data cross-check: ${formatSf(comparisonValue)} SF; ` +
    `variance: ${formatSf(varianceAbsolute)} SF (${formatPct(variancePercentage)}).`;
  if (input.knownDifference)
    return {
      classification: "known-difference",
      authoritativeValue,
      comparisonValue,
      varianceAbsolute,
      variancePercentage,
      reason:
        input.knownDifferenceReason ??
        "Expected reconciliation difference approved for QA tracking.",
      message:
        `Property Data inventory differs by ${formatSf(varianceAbsolute)} SF; official Market_Data remains selected. ` +
        `${detail} Classification: known-difference. Reason: ${input.knownDifferenceReason ?? "Expected reconciliation difference approved for QA tracking."}`,
    };

  const materiallyLarge =
    variancePercentage >= HARD_RELATIVE_VARIANCE ||
    (varianceAbsolute >= BLOCKING_ABSOLUTE_VARIANCE_SF &&
      variancePercentage >= BLOCKING_RELATIVE_VARIANCE);
  const classification = materiallyLarge ? "blocking" : "warning";
  const reason = materiallyLarge
    ? "Unexplained variance exceeds inventory reconciliation materiality thresholds."
    : "Unexplained variance is below blocking materiality thresholds; QA review remains required.";
  return {
    classification,
    authoritativeValue,
    comparisonValue,
    varianceAbsolute,
    variancePercentage,
    reason,
    message:
      `Property Data inventory differs by ${formatSf(varianceAbsolute)} SF; official Market_Data remains selected. ` +
      `${detail} Classification: ${classification}. Reason: ${reason}`,
  };
}
