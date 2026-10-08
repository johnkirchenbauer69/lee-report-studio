import { expect, it } from "vitest";
import { sanitizeSalesforceClientPayload } from "./salesforceIds";
it("preserves encoded presentation bytes and still sanitizes ordinary display text", () => {
  const image = "data:image/png;base64,abc001ABC123def456+abc001ABC123def456/";
  expect(
    sanitizeSalesforceClientPayload({ image, label: "001ABC123def456" }),
  ).toEqual({ image, label: "Salesforce record" });
  expect(
    sanitizeSalesforceClientPayload("data:text/plain;base64,001ABC123def456"),
  ).toContain("Salesforce record");
});
