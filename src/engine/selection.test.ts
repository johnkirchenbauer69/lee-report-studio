import { describe, expect, it } from "vitest";
import { nextSelection } from "./selection";

describe("selection reducer", () => {
  it("replaces selection on a normal click", () => {
    expect(nextSelection(["a", "b"], "c", false)).toEqual(["c"]);
  });

  it("adds and toggles elements with additive selection", () => {
    expect(nextSelection(["a"], "b", true)).toEqual(["a", "b"]);
    expect(nextSelection(["a", "b"], "a", true)).toEqual(["b"]);
  });
});
