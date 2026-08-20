import { describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import {
  isUnsafeZipEntry,
  parseFontMetadata,
  readFontBundle,
} from "./fontImport";

const zipBuffer = () =>
  new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.addBuffer(Buffer.from("not a real font"), "Fonts/Test-Regular.ttf");
    zip.addBuffer(
      Buffer.from("SIL OPEN FONT LICENSE Version 1.1"),
      "Fonts/OFL.txt",
    );
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
});
