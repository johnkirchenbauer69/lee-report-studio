import { describe, expect, it } from "vitest";
import { canMutateDocument } from "./documentPermissions";

describe("document mutation permission", () => {
  it("allows draft templates and generated reports", () => {
    expect(
      canMutateDocument({ mode: "master-template", templateStatus: "draft" }),
    ).toBe(true);
    expect(canMutateDocument({ mode: "report-instance" })).toBe(true);
  });

  it("makes published and archived template artifacts immutable", () => {
    expect(
      canMutateDocument({
        mode: "master-template",
        templateStatus: "published",
      }),
    ).toBe(false);
    expect(
      canMutateDocument({
        mode: "master-template",
        templateStatus: "archived",
      }),
    ).toBe(false);
  });
});
