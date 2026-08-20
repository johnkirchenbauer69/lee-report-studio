import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSalesforceConfig } from "./config.ts";
import {
  SalesforceRestClient,
  SoapLoginAuthStrategy,
} from "./SalesforceClient.ts";
const names = [
  "SALESFORCE_AUTH_MODE",
  "SALESFORCE_LOGIN_URL",
  "SALESFORCE_CLIENT_ID",
  "SALESFORCE_CLIENT_SECRET",
  "SF_USERNAME",
  "SF_PASSWORD",
  "SF_SECURITY_TOKEN",
  "SF_DOMAIN",
] as const;
const original = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of names)
    original[name] === undefined
      ? delete process.env[name]
      : (process.env[name] = original[name]!);
});
describe("Salesforce authentication configuration", () => {
  it("fails clearly instead of selecting a fallback", () => {
    for (const name of names) delete process.env[name];
    expect(() => loadSalesforceConfig()).toThrow("SALESFORCE_AUTH_MODE");
  });
  it("supports SOAP login and reuses its session for REST without exposing credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<Envelope><sessionId>session-secret</sessionId><serverUrl>https://example.my.salesforce.com/services/Soap/u/65.0/id</serverUrl></Envelope>`,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ done: true, records: [{ Id: "1" }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const strategy = new SoapLoginAuthStrategy({
      username: "user@example.com",
      password: "password",
      securityToken: "token",
      domain: "login",
      apiVersion: "65.0",
    });
    const client = new SalesforceRestClient({
      authStrategy: strategy,
      apiVersion: "65.0",
    });
    await expect(
      client.query("SELECT Id FROM Account WHERE Name = 'Safe'"),
    ).resolves.toEqual([{ Id: "1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe(
      "Bearer session-secret",
    );
  });
  it("does not fall back after an explicit SOAP failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    const strategy = new SoapLoginAuthStrategy({
      username: "u",
      password: "p",
      securityToken: "t",
      domain: "test",
      apiVersion: "65.0",
    });
    await expect(strategy.authenticate()).rejects.toThrow(
      "No alternate authentication mode was attempted",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
