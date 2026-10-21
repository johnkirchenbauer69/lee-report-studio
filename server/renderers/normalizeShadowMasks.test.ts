import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { normalizeShadowMasks } from "./normalizeShadowMasks";

const n = PDFName.of;
async function fixture() {
  const pdf = await PDFDocument.create();
  const c = pdf.context;
  const image = c.flateStream(Uint8Array.from([0, 64, 128, 255]), {
    Type: "XObject",
    Subtype: "Image",
    Width: 2,
    Height: 2,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 8,
  });
  const imageRef = c.register(image);
  const form = c.flateStream(
    "q\n2 0 0 -2 0 2 cm\n0 0 0 RG 0 0 0 rg\n/G1 gs\n/X1 Do\nQ\n",
    {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 2, 2],
      Group: { S: "Transparency", CS: "DeviceGray", I: true },
      Resources: {
        ExtGState: { G1: { ca: 1, BM: "Normal" } },
        XObject: { X1: imageRef },
      },
    },
  );
  const formRef = c.register(form);
  const mask = c.obj({ S: "Luminosity", G: formRef });
  const state = c.obj({ Type: "ExtGState", SMask: mask });
  const stateRef = c.register(state);
  const page = pdf.addPage([612, 792]);
  page.node.set(n("Resources"), c.obj({ ExtGState: { G2: stateRef } }));
  const content = c.flateStream("q /G2 gs 0 0 0 rg 0 0 2 2 re f Q");
  page.node.set(n("Contents"), c.register(content));
  return { pdf, c, image, imageRef, form, formRef, mask, state, content };
}

describe("shadow mask normalization", () => {
  it("preserves samples, page paint and shared originals; survives serialization and is idempotent", async () => {
    const f = await fixture();
    const imageBefore = f.image.getContents().slice();
    expect(normalizeShadowMasks(f.pdf)).toEqual({ converted: 1, skipped: 0 });
    const mask = f.state.lookup(n("SMask"), PDFDict);
    expect(mask.get(n("S"))).toBe(n("Alpha"));
    expect(f.mask.get(n("S"))).toBe(n("Luminosity"));
    const form = f.c.lookup(mask.get(n("G"))) as PDFRawStream;
    expect(form).not.toBe(f.form);
    expect(form.getContents()).toEqual(f.form.getContents());
    const images = form.dict
      .lookup(n("Resources"), PDFDict)
      .lookup(n("XObject"), PDFDict);
    const white = f.c.lookup(images.get(n("X1"))) as PDFRawStream;
    expect(decodePDFRawStream(white).decode()).toEqual(
      Uint8Array.from([255, 255, 255, 255]),
    );
    expect(white.dict.get(n("SMask"))).toBe(f.imageRef);
    expect(f.image.getContents()).toEqual(imageBefore);
    expect(normalizeShadowMasks(f.pdf)).toEqual({ converted: 0, skipped: 0 });
    const loaded = await PDFDocument.load(await f.pdf.save());
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const content = loaded.context.lookup(
      loaded.getPage(0).node.get(n("Contents")),
    ) as PDFRawStream;
    expect(decodePDFRawStream(content).decode()).toEqual(
      decodePDFRawStream(f.content).decode(),
    );
    expect(normalizeShadowMasks(loaded)).toEqual({ converted: 0, skipped: 0 });
  });

  it("reuses a normalized form when graphics states share it", async () => {
    const f = await fixture();
    const second = f.c.obj({ SMask: f.mask });
    f.c.register(second);
    expect(normalizeShadowMasks(f.pdf)).toEqual({ converted: 2, skipped: 0 });
    expect(f.state.lookup(n("SMask"), PDFDict).get(n("G"))).toBe(
      second.lookup(n("SMask"), PDFDict).get(n("G")),
    );
  });

  it.each([
    "color",
    "non-isolated",
    "transfer",
    "backdrop",
    "decoded-image",
    "nested-alpha",
    "opacity",
    "complex-paint",
    "oversized",
  ])("leaves unsupported %s masks unchanged", async (mode) => {
    const f = await fixture();
    const group = f.form.dict.lookup(n("Group"), PDFDict);
    if (mode === "color") group.set(n("CS"), n("DeviceRGB"));
    if (mode === "non-isolated") group.set(n("I"), f.c.obj(false));
    if (mode === "transfer") f.mask.set(n("TR"), n("Identity"));
    if (mode === "backdrop") f.mask.set(n("BC"), f.c.obj([1]));
    if (mode === "decoded-image")
      f.image.dict.set(n("Decode"), f.c.obj([1, 0]));
    if (mode === "nested-alpha") f.image.dict.set(n("SMask"), f.imageRef);
    if (mode === "opacity")
      f.form.dict
        .lookup(n("Resources"), PDFDict)
        .lookup(n("ExtGState"), PDFDict)
        .lookup(n("G1"), PDFDict)
        .set(n("ca"), f.c.obj(0.5));
    if (mode === "complex-paint") {
      const dict = f.form.dict.clone();
      dict.delete(n("Filter"));
      f.c.assign(
        f.formRef,
        PDFRawStream.of(dict, Buffer.from("q 0 0 2 2 re f Q")),
      );
    }
    if (mode === "oversized")
      f.image.dict.set(n("Width"), f.c.obj(100_000_000));
    expect(normalizeShadowMasks(f.pdf)).toEqual({ converted: 0, skipped: 1 });
    expect(f.state.get(n("SMask"))).toBe(f.mask);
    expect(f.mask.get(n("S"))).toBe(n("Luminosity"));
  });
});
