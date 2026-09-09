import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReportSaveConflictError,
  reportInstanceStore,
} from "./reportInstanceStore";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reportInstanceStore document saves", () => {
  it("turns the API conflict contract into a typed client error", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "stale",
            code: "REPORT_INSTANCE_CONFLICT",
            baseRevision: 4,
            currentRevision: 5,
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    try {
      await reportInstanceStore.saveDocument("report-client-conflict", {
        baseRevision: 4,
        pages: [],
        manualOverrides: [],
      });
      throw new Error("Expected a report save conflict.");
    } catch (error) {
      expect(error).toBeInstanceOf(ReportSaveConflictError);
      expect(error).toMatchObject({
        baseRevision: 4,
        currentRevision: 5,
      });
    }
  });

  it("aborts a report autosave request after the defined API timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            );
          }),
      ),
    );

    const save = reportInstanceStore.saveDocument("report-client-timeout", {
      baseRevision: 1,
      pages: [],
      manualOverrides: [],
    });
    const assertion = expect(save).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
