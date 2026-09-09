import { describe, expect, it } from "vitest";
import {
  containsSalesforceIdToken,
  isSalesforceAttachmentOrFileId,
  looksLikeSalesforceId,
  sanitizeSalesforceDisplayValue,
} from "./salesforceIds";
import { sanitizeSalesforceClientPayload } from "../../../src/shared/salesforceIds";

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
    expect(
      sanitizeSalesforceDisplayValue(
        "Property 001al00000dS4qYAAS is internal",
        "Salesforce record",
      ),
    ).toBe("Property Salesforce record is internal");
    expect(
      JSON.stringify(
        sanitizeSalesforceClientPayload({
          details: [{ propertyId: "001al00000dS4qYAAS" }],
        }),
      ),
    ).not.toMatch(/001al00000dS4qYAAS/);
  });

  it("limits file-id detection to Attachment and Content prefixes", () => {
    expect(isSalesforceAttachmentOrFileId("00PVy00000AbCdEfGh")).toBe(true);
    expect(isSalesforceAttachmentOrFileId("068Vy00000AbCdEfGh")).toBe(true);
    expect(isSalesforceAttachmentOrFileId("001al00000dS4qYAAS")).toBe(false);
  });

  it("does not rewrite ordinary 15/18-character tokens or opaque hashes", () => {
    const checksum =
      "df8908a06ac93b8bf7eda3f644b388c516f7967c08d7d5bc94d9ef0eb0df3da3";
    const payload = {
      checksum,
      sourcePath: "submarketTableRows",
      bindingPath: "topConstruction[0]",
      preservedSpacing: "LEE  Report Studio",
    };

    expect(containsSalesforceIdToken(payload.sourcePath)).toBe(false);
    expect(containsSalesforceIdToken(payload.bindingPath)).toBe(false);
    expect(sanitizeSalesforceClientPayload(payload)).toEqual(payload);
  });
});
