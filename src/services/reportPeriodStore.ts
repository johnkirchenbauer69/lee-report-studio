import type { ReportPeriodsResponse } from "../report-engine/schema/reportPeriods";
import { resolveApiUrl } from "../shared/apiBaseUrl";

export class ReportPeriodDiscoveryError extends Error {
  constructor(message = "Available report periods could not be loaded.") {
    super(message);
    this.name = "ReportPeriodDiscoveryError";
  }
}

export async function loadReportPeriods(
  endpoint = "/api/report-data/industrial-market/periods",
  apiBaseUrl?: string,
): Promise<ReportPeriodsResponse> {
  const url = resolveApiUrl(endpoint, {
    explicit: apiBaseUrl,
    origin: globalThis.location?.origin,
  });
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    throw new ReportPeriodDiscoveryError();
  }
  if (!response.ok) throw new ReportPeriodDiscoveryError();
  const payload = (await response.json()) as Partial<ReportPeriodsResponse>;
  if (
    !Array.isArray(payload.periods) ||
    (payload.mode !== "mock" && payload.mode !== "salesforce")
  )
    throw new ReportPeriodDiscoveryError(
      "The report-period service returned an invalid response.",
    );
  return payload as ReportPeriodsResponse;
}
