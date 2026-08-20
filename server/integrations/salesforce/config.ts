import {
  ClientCredentialsAuthStrategy,
  SoapLoginAuthStrategy,
  type SalesforceAuthMode,
  type SalesforceRestConfig,
} from "./SalesforceClient.ts";
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
  if (!mode && process.env.NODE_ENV === "production")
    throw new Error(
      "REPORT_DATA_MODE must be explicitly configured in production.",
    );
  const resolved = mode ?? "mock";
  if (resolved !== "mock" && resolved !== "salesforce")
    throw new Error("REPORT_DATA_MODE must be either mock or salesforce.");
  return resolved;
}
export function getSalesforceAuthMode(): SalesforceAuthMode {
  const mode = required("SALESFORCE_AUTH_MODE");
  if (mode !== "client-credentials" && mode !== "soap-login")
    throw new Error(
      "SALESFORCE_AUTH_MODE must be client-credentials or soap-login.",
    );
  return mode;
}
export function loadSalesforceConfig(): SalesforceRestConfig {
  const apiVersion = process.env.SALESFORCE_API_VERSION?.trim() || "65.0";
  const mode = getSalesforceAuthMode();
  if (mode === "client-credentials")
    return {
      apiVersion,
      authStrategy: new ClientCredentialsAuthStrategy({
        loginUrl: required("SALESFORCE_LOGIN_URL").replace(/\/$/, ""),
        clientId: required("SALESFORCE_CLIENT_ID"),
        clientSecret: required("SALESFORCE_CLIENT_SECRET"),
        instanceUrl: process.env.SALESFORCE_INSTANCE_URL?.trim().replace(
          /\/$/,
          "",
        ),
      }),
    };
  const domain = required("SF_DOMAIN");
  if (domain !== "login" && domain !== "test")
    throw new Error("SF_DOMAIN must be login or test.");
  return {
    apiVersion,
    authStrategy: new SoapLoginAuthStrategy({
      username: required("SF_USERNAME"),
      password: required("SF_PASSWORD"),
      securityToken: required("SF_SECURITY_TOKEN"),
      domain,
      apiVersion,
    }),
  };
}
export function isSalesforceConfigured() {
  try {
    loadSalesforceConfig();
    return true;
  } catch {
    return false;
  }
}
