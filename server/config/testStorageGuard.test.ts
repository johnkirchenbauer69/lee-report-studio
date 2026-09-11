import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeDataRoot,
  resolveDefaultDataRoot,
  UnsafeTestDataRootError,
} from "./testStorageGuard";

describe("assertSafeDataRoot", () => {
  const defaultDataRoot = resolveDefaultDataRoot();

  it("throws when a test process resolves to the default development data root", () => {
    expect(() =>
      assertSafeDataRoot({ nodeEnv: "test", dataRoot: "server/data" }),
    ).toThrow(UnsafeTestDataRootError);
  });

  it("throws for an equivalent unnormalized path to the default root", () => {
    expect(() =>
      assertSafeDataRoot({
        nodeEnv: "test",
        dataRoot: "./server/../server/data",
      }),
    ).toThrow(UnsafeTestDataRootError);
  });

  it("allows a test process pointed at an isolated directory", () => {
    expect(() =>
      assertSafeDataRoot({
        nodeEnv: "test",
        dataRoot: path.join("tmp", "playwright-data"),
      }),
    ).not.toThrow();
  });

  it("does not gate non-test environments even against the default root", () => {
    expect(() =>
      assertSafeDataRoot({ nodeEnv: "development", dataRoot: "server/data" }),
    ).not.toThrow();
    expect(() =>
      assertSafeDataRoot({ nodeEnv: undefined, dataRoot: "server/data" }),
    ).not.toThrow();
  });

  it("respects an explicitly supplied default root override", () => {
    const isolatedDefault = path.resolve("tmp/other-default");
    expect(() =>
      assertSafeDataRoot({
        nodeEnv: "test",
        dataRoot: "tmp/other-default",
        defaultDataRoot: isolatedDefault,
      }),
    ).toThrow(UnsafeTestDataRootError);
  });
});
