import { describe, expect, it } from "vitest";
import {
  clampCornerRadii,
  resolveCornerRadii,
  updateCornerRadius,
} from "./corners";

describe("structured corner radii", () => {
  it("migrates the legacy uniform radius without changing appearance", () => {
    expect(resolveCornerRadii({ borderRadius: 12 }, 100, 60)).toEqual({
      topLeft: 12,
      topRight: 12,
      bottomRight: 12,
      bottomLeft: 12,
      linked: true,
    });
  });

  it("updates every corner while linked and just one while unlinked", () => {
    const linked = resolveCornerRadii({ borderRadius: 4 }, 100, 60);
    expect(updateCornerRadius(linked, "topLeft", 18, 100, 60)).toMatchObject({
      topLeft: 18,
      topRight: 18,
      bottomRight: 18,
      bottomLeft: 18,
    });
    expect(
      updateCornerRadius(
        { ...linked, linked: false },
        "bottomRight",
        22,
        100,
        60,
      ),
    ).toMatchObject({
      topLeft: 4,
      topRight: 4,
      bottomLeft: 4,
      bottomRight: 22,
    });
  });

  it("clamps every radius after geometry becomes smaller", () => {
    expect(
      clampCornerRadii(
        {
          topLeft: 50,
          topRight: 40,
          bottomRight: -1,
          bottomLeft: 8,
          linked: false,
        },
        30,
        20,
      ),
    ).toEqual({
      topLeft: 10,
      topRight: 10,
      bottomRight: 0,
      bottomLeft: 8,
      linked: false,
    });
  });
});
