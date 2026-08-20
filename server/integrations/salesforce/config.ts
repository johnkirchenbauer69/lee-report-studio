import type { SalesforceRestConfig } from "./SalesforceClient.ts";

export type ReportDataMode = "mock" | "salesforce";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(
      `Salesforce integration is not configured: ${name} is required.`,
    );
  return value;
};

export function getReportDataMode(): ReportDataMode {
  const mode = process.env.REPORT_DATA_MODE;
  if (!mode && process.env.NODE_ENV === "production") {
    throw new Error(
      "REPORT_DATA_MODE must be explicitly configured in production.",
    );
  }
  const resolvedMode = mode ?? "mock";
  if (resolvedMode !== "mock" && resolvedMode !== "salesforce") {
    throw new Error("REPORT_DATA_MODE must be either mock or salesforce.");
  }
  return resolvedMode;
}

export function loadSalesforceConfig(): SalesforceRestConfig {
  return {
    loginUrl: required("SALESFORCE_LOGIN_URL").replace(/\/$/, ""),
    clientId: required("SALESFORCE_CLIENT_ID"),
    clientSecret: required("SALESFORCE_CLIENT_SECRET"),
    instanceUrl: process.env.SALESFORCE_INSTANCE_URL?.replace(/\/$/, ""),
    apiVersion: process.env.SALESFORCE_API_VERSION ?? "65.0",
  };
}

export function isSalesforceConfigured() {
  return [
    "SALESFORCE_LOGIN_URL",
    "SALESFORCE_CLIENT_ID",
    "SALESFORCE_CLIENT_SECRET",
  ].every((name) => Boolean(process.env[name]?.trim()));
}
