import { describe, expect, it } from "vitest";
import {
  classifyExportError,
  describeExportFailure,
} from "./pdfExportDiagnostics";

describe("classifyExportError", () => {
  it("classifies preflight errors as preflight-blocked", () => {
    const failure = classifyExportError(
      "preflight",
      new Error("Cover image extends outside Page 1."),
    );
    expect(failure).toMatchObject({
      phase: "preflight",
      category: "preflight-blocked",
    });
  });

  it("classifies a Chromium network failure as api-unavailable", () => {
    const failure = classifyExportError(
      "chromium",
      new TypeError("Failed to fetch"),
    );
    expect(failure.category).toBe("api-unavailable");
  });

  it("classifies a Chromium render timeout as server-error", () => {
    const failure = classifyExportError(
      "chromium",
      new Error("Timed out waiting for [data-render-ready=\"true\"]."),
    );
    expect(failure.category).toBe("server-error");
  });

  it("classifies the managed-font fallback guard as font", () => {
    const failure = classifyExportError(
      "fallback",
      new Error(
        "Managed-font reports require the Chromium PDF renderer so editor and PDF typography remain identical.",
      ),
    );
    expect(failure.category).toBe("font");
  });

  it("classifies the rotated-table/chart fallback guard as unsupported-feature", () => {
    const failure = classifyExportError(
      "fallback",
      new Error("Rotated table elements require the Chromium PDF renderer."),
    );
    expect(failure.category).toBe("unsupported-feature");
  });

  it("classifies an image failure in the fallback renderer as asset", () => {
    const failure = classifyExportError(
      "fallback",
      new Error("Image cover-photo could not be loaded for PDF export."),
    );
    expect(failure.category).toBe("asset");
  });

  it("falls back to unknown for an unrecognized error", () => {
    const failure = classifyExportError("fallback", new Error("boom"));
    expect(failure.category).toBe("unknown");
  });

  it("preserves the original error as the cause", () => {
    const original = new Error("boom");
    const failure = classifyExportError("fallback", original);
    expect(failure.cause).toBe(original);
  });
});

describe("describeExportFailure", () => {
  it("describes a preflight-only failure", () => {
    const failure = classifyExportError("preflight", new Error("bad layout"));
    expect(describeExportFailure(failure)).toMatch(
      /Preflight validation failed \(blocked by validation errors\): bad layout/,
    );
  });

  it("describes a Chromium-only failure", () => {
    const failure = classifyExportError(
      "chromium",
      new TypeError("Failed to fetch"),
    );
    expect(describeExportFailure(failure)).toMatch(
      /Chromium export failed \(renderer unavailable\)/,
    );
  });

  it("describes both a Chromium and fallback failure together", () => {
    const chromium = classifyExportError(
      "chromium",
      new Error("Timed out waiting for render-ready."),
    );
    const fallback = classifyExportError(
      "fallback",
      new Error("Rotated table elements require the Chromium PDF renderer."),
    );
    const message = describeExportFailure(chromium, fallback);
    expect(message).toMatch(/Chromium export failed \(internal server error\)/);
    expect(message).toMatch(
      /Fallback export failed \(unsupported feature\)/,
    );
  });

  it("falls back to the generic message when nothing is provided", () => {
    expect(describeExportFailure()).toBe("The PDF could not be generated.");
  });
});
