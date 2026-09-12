import { describe, expect, it } from "vitest";
import { sanitizePublicationEntity } from "./publicationEntitySafety";

describe("sanitizePublicationEntity", () => {
  it("passes through a legitimate legal entity name unchanged", () => {
    expect(sanitizePublicationEntity("Acme Logistics LLC")).toBe(
      "Acme Logistics LLC",
    );
    expect(sanitizePublicationEntity("Prologis, L.P.")).toBe("Prologis, L.P.");
  });

  it("blanks a bare internal placeholder", () => {
    expect(sanitizePublicationEntity("TBD")).toBe("");
    expect(sanitizePublicationEntity("  n/a  ")).toBe("");
    expect(sanitizePublicationEntity("Pending")).toBe("");
  });

  it("blanks a value containing an internal workflow note", () => {
    expect(sanitizePublicationEntity("waiting for comp")).toBe("");
    expect(sanitizePublicationEntity("Need comp before publishing")).toBe("");
    expect(sanitizePublicationEntity("Internal note: confirm size")).toBe("");
  });

  it("strips a trailing CRM scratch suffix and keeps the real name", () => {
    expect(sanitizePublicationEntity("Acme Logistics - waiting for comp")).toBe(
      "Acme Logistics",
    );
    expect(sanitizePublicationEntity("Acme Logistics (TBD)")).toBe(
      "Acme Logistics",
    );
    expect(sanitizePublicationEntity("Acme Logistics | pending comp")).toBe(
      "Acme Logistics",
    );
  });

  it("omits rather than guesses when nothing safe survives", () => {
    expect(sanitizePublicationEntity("- waiting for comp")).toBe("");
    expect(sanitizePublicationEntity("")).toBe("");
    expect(sanitizePublicationEntity(undefined)).toBe("");
  });

  it("does not mistake a real name containing a substring for a placeholder", () => {
    expect(sanitizePublicationEntity("Confirmed Logistics Group")).not.toBe(
      "",
    );
  });
});
