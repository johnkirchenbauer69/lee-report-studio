import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl, resolveApiUrl } from "./apiBaseUrl";

describe("API base URL configuration", () => {
  it("uses local development only when no explicit source exists", () => {
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:8787");
  });

  it("honors explicit URL before environment and origin", () => {
    expect(
      resolveApiUrl("/api/report-data/industrial-market", {
        explicit: "https://explicit.example:9443/root/",
        environment: { LEE_API_URL: "https://environment.example" },
        origin: "https://origin.example",
      }),
    ).toBe(
      "https://explicit.example:9443/root/api/report-data/industrial-market",
    );
  });

  it("supports LEE_API_URL, custom ports, trailing slashes, and base paths", () => {
    expect(
      resolveApiUrl("api/health", {
        environment: { LEE_API_URL: "http://custom-host:9123/studio///" },
      }),
    ).toBe("http://custom-host:9123/studio/api/health");
  });
});
