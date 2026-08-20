import { afterEach, describe, expect, it } from "vitest";
import { loadSalesforceConfig } from "./config.ts";

const names = [
  "SALESFORCE_LOGIN_URL",
  "SALESFORCE_CLIENT_ID",
  "SALESFORCE_CLIENT_SECRET",
] as const;

describe("Salesforce configuration", () => {
  const original = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  afterEach(() => {
    for (const name of names) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("fails clearly and never falls back when Salesforce credentials are absent", () => {
    for (const name of names) delete process.env[name];
    expect(() => loadSalesforceConfig()).toThrow(
      "Salesforce integration is not configured",
    );
  });
});
