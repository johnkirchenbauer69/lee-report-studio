/**
 * Classifies PDF export failures into a small, user-facing taxonomy so the
 * "Export PDF" toast can say what actually went wrong instead of the generic
 * "The PDF could not be generated." message. Developer-level detail (the
 * original error/stack) is always preserved on `cause` for console logging.
 */

export type ExportFailurePhase = "preflight" | "chromium" | "fallback";

export type ExportFailureCategory =
  | "preflight-blocked"
  | "api-unavailable"
  | "font"
  | "asset"
  | "unsupported-feature"
  | "server-error"
  | "unknown";

export interface ExportFailure {
  phase: ExportFailurePhase;
  category: ExportFailureCategory;
  message: string;
  cause: unknown;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? "Unknown error");

const phaseLabel: Record<ExportFailurePhase, string> = {
  preflight: "Preflight validation",
  chromium: "Chromium export",
  fallback: "Fallback export",
};

const categoryLabel: Record<ExportFailureCategory, string> = {
  "preflight-blocked": "blocked by validation errors",
  "api-unavailable": "renderer unavailable",
  font: "font issue",
  asset: "asset issue",
  "unsupported-feature": "unsupported feature",
  "server-error": "internal server error",
  unknown: "unknown error",
};

/**
 * Determines the failure category for a given export phase, based on the
 * error text produced by that phase's known failure modes:
 * - preflight: always "preflight-blocked" (the caller supplies the joined
 *   issue messages as `error`).
 * - chromium: network/fetch failures (the browser could not reach
 *   `/api/render/pdf` at all) vs. server-side render errors (Playwright
 *   timeout, missing render-ready selector, etc., surfaced as JSON by the
 *   Express error middleware).
 * - fallback: the deterministic pdf-lib renderer's own guard conditions
 *   (managed fonts / rotated tables & charts require Chromium) plus
 *   image/asset failures.
 */
export function classifyExportError(
  phase: ExportFailurePhase,
  error: unknown,
): ExportFailure {
  const message = messageOf(error);
  if (phase === "preflight")
    return { phase, category: "preflight-blocked", message, cause: error };

  if (phase === "chromium") {
    if (
      error instanceof TypeError ||
      /fetch failed|failed to fetch|network/i.test(message)
    )
      return { phase, category: "api-unavailable", message, cause: error };
    if (/render-ready|timeout|playwright|chromium/i.test(message))
      return { phase, category: "server-error", message, cause: error };
    return { phase, category: "unknown", message, cause: error };
  }

  // phase === "fallback"
  if (/rotated/i.test(message) && /chromium/i.test(message))
    return { phase, category: "unsupported-feature", message, cause: error };
  if (/managed-font|Chromium PDF renderer/i.test(message))
    return { phase, category: "font", message, cause: error };
  if (/image|asset/i.test(message))
    return { phase, category: "asset", message, cause: error };
  return { phase, category: "unknown", message, cause: error };
}

/** Builds the concise, human-readable toast text for one or two failures. */
export function describeExportFailure(
  chromium?: ExportFailure,
  fallback?: ExportFailure,
): string {
  const parts = [chromium, fallback]
    .filter((failure): failure is ExportFailure => Boolean(failure))
    .map(
      (failure) =>
        `${phaseLabel[failure.phase]} failed (${categoryLabel[failure.category]}): ${failure.message}`,
    );
  if (!parts.length) return "The PDF could not be generated.";
  return parts.join(" ");
}
