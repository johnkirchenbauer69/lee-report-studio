import { expect, it } from "vitest";
import { isLocalOperatorOrigin } from "./nativeExportRoutes";
it("requires an explicit local origin on the application protocol and port", () => {
  for (const origin of [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])
    expect(isLocalOperatorOrigin(origin, "http://127.0.0.1:3000")).toBe(true);
  for (const origin of [
    undefined,
    "null",
    "https://localhost:3000",
    "http://localhost:3001",
    "http://localhost.evil.test:3000",
    "http://example.com:3000",
  ])
    expect(isLocalOperatorOrigin(origin, "http://127.0.0.1:3000")).toBe(false);
});
