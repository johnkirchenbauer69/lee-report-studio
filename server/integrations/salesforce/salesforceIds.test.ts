import { describe, expect, it } from "vitest";
import {
  containsSalesforceIdToken,
  isSalesforceAttachmentOrFileId,
  looksLikeSalesforceId,
  sanitizeSalesforceDisplayValue,
} from "./salesforceIds";

describe("Salesforce display value safety", () => {
  it("recognizes record ids and strips them without imposing a display fallback", () => {
    expect(looksLikeSalesforceId("001al00000dS4qYAAS")).toBe(true);
    expect(sanitizeSalesforceDisplayValue(" 001al00000dS4qYAAS ")).toBe("");
    expect(sanitizeSalesforceDisplayValue("  Venture One  ")).toBe(
      "Venture One",
    );
    expect(sanitizeSalesforceDisplayValue(null)).toBe("");
    expect(
      containsSalesforceIdToken("Tenant note 001al00000dS4qYAAS internal"),
    ).toBe(true);
    expect(containsSalesforceIdToken("Tenant note for Q2 2026")).toBe(false);
  });

  it("limits file-id detection to Attachment and Content prefixes", () => {
    expect(isSalesforceAttachmentOrFileId("00PVy00000AbCdEfGh")).toBe(true);
    expect(isSalesforceAttachmentOrFileId("068Vy00000AbCdEfGh")).toBe(true);
    expect(isSalesforceAttachmentOrFileId("001al00000dS4qYAAS")).toBe(false);
  });
});
