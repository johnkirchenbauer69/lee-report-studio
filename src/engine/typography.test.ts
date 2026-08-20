import { describe, expect, it } from "vitest";
import {
  resolveTypography,
  verticalAlignmentClass,
  withTypography,
} from "./typography";

describe("text typography controls", () => {
  it("resolves the actual legacy template color and alignment", () => {
    expect(
      resolveTypography({
        color: "#ffffff",
        fontFamily: "Avenir Next",
        fontSize: 17,
        fontWeight: 800,
        textAlign: "center",
      }),
    ).toMatchObject({
      color: "#ffffff",
      fontFamily: "Avenir Next",
      fontSize: 17,
      fontWeight: 800,
      textAlign: "center",
      verticalAlign: "top",
    });
  });

  it("applies color and vertical-middle changes without losing legacy styles", () => {
    const style = withTypography(
      { color: "#ffffff", fontSize: 17, fontWeight: 800 },
      { color: "#c4123f", verticalAlign: "middle" },
    );

    expect(style.typography).toMatchObject({
      color: "#c4123f",
      fontSize: 17,
      fontWeight: 800,
      verticalAlign: "middle",
    });
    expect(verticalAlignmentClass(style.typography!.verticalAlign)).toBe(
      "vertical-middle",
    );
  });
});
