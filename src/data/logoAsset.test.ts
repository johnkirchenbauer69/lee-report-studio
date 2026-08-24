import fs from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

describe("LEE logo asset", () => {
  it("uses true RGBA transparency with a transparent background pixel", () => {
    const png = PNG.sync.read(
      fs.readFileSync("public/report-assets/lee-logo-white.png"),
    );
    expect(png.alpha).toBe(true);
    expect(png.data[3]).toBe(0);
    expect(
      Array.from(
        { length: png.width * png.height },
        (_, index) => png.data[index * 4 + 3],
      ).some((alpha) => alpha > 0),
    ).toBe(true);
  });
});
