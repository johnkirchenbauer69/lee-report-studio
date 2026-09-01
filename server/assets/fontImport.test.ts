import { describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import {
  classifyFontFamilyWidth,
  inferNamedWeight,
  isUnsafeZipEntry,
  parseFontMetadata,
  readFontBundle,
} from "./fontImport";

const zipBuffer = (
  licenseName = "Fonts/OFL.txt",
  licenseContents = "SIL OPEN FONT LICENSE Version 1.1",
) =>
  new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.addBuffer(Buffer.from("not a real font"), "Fonts/Test-Regular.ttf");
    zip.addBuffer(Buffer.from(licenseContents), licenseName);
    zip.end();
  });

describe("secure font bundle import", () => {
  it("rejects ZIP-slip paths before extraction", () => {
    expect(isUnsafeZipEntry("../font.ttf")).toBe(true);
    expect(isUnsafeZipEntry("C:\\font.ttf")).toBe(true);
    expect(isUnsafeZipEntry("Fonts/NunitoSans-Regular.ttf")).toBe(false);
  });

  it("discovers font entries and captures an OFL license", async () => {
    const bundle = await readFontBundle(await zipBuffer());
    expect(bundle.fonts.map((font) => font.name)).toEqual(["Test-Regular.ttf"]);
    expect(bundle.license).toEqual({
      type: "SIL Open Font License 1.1",
      fileName: "OFL.txt",
    });
  });

  it("rejects invalid font bytes instead of trusting the extension", () => {
    expect(() => parseFontMetadata(Buffer.from("not a font"))).toThrow();
  });

  it("recognizes supported license documents without inferring from the ZIP name", async () => {
    const apache = await readFontBundle(
      await zipBuffer(
        "LICENSE.txt",
        "Apache License\nVersion 2.0, January 2004",
      ),
    );
    expect(apache.license).toEqual({
      type: "Apache License 2.0",
      fileName: "LICENSE.txt",
    });
    const nestedOfL = await readFontBundle(
      await zipBuffer(
        "Metropolis/SIL Open Font License.txt",
        "SIL OPEN FONT LICENSE Version 1.1",
      ),
    );
    expect(nestedOfL.license?.type).toBe("SIL Open Font License 1.1");
  });

  it("uses specific embedded naming metadata when numeric weight metadata is wrong", () => {
    expect(inferNamedWeight("Metropolis Thin", "Metropolis-Thin")).toBe(100);
    expect(
      inferNamedWeight("Metropolis Extra Light Italic", "ExtraLightItalic"),
    ).toBe(200);
    expect(
      inferNamedWeight("Metropolis Semi Bold Italic", "SemiBoldItalic"),
    ).toBe(600);
    expect(inferNamedWeight("Mada Black", "Mada-Black")).toBe(900);
    expect(inferNamedWeight("Avenir Next LT Pro Demi", "Bold")).toBe(600);
  });

  it("keeps embedded condensed-width faces out of regular CSS slots", () => {
    expect(classifyFontFamilyWidth("Avenir Next LT Pro", 5)).toBe(
      "Avenir Next LT Pro",
    );
    expect(classifyFontFamilyWidth("Avenir Next LT Pro", 3)).toBe(
      "Avenir Next LT Pro Condensed",
    );
  });
});
