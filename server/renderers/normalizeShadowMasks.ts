import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

const name = PDFName.of;
const numeric = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)";
// Recognize only Skia's isolated single-image shadow recipe, not arbitrary PDF.
const recipe = new RegExp(
  `^\\s*q\\s+(?:${numeric}\\s+){6}cm\\s+0 0 0 RG\\s+0 0 0 rg\\s+/([A-Za-z0-9]+) gs\\s+/([A-Za-z0-9]+) Do\\s+Q\\s*$`,
);

export interface ShadowMaskNormalization {
  converted: number;
  skipped: number;
}

/** Preserve grayscale shadow samples as alpha instead of luminosity coverage.
 * No foreground streams, font programs, annotations or image samples are changed.
 * Unsupported masks are left intact. Cloned forms/resources avoid affecting other
 * users of shared objects. This is deliberately not a general PDF flattener.
 */
export function normalizeShadowMasks(
  pdf: PDFDocument,
): ShadowMaskNormalization {
  const context = pdf.context;
  const result = { converted: 0, skipped: 0 };
  const forms = new Map<PDFRawStream, ReturnType<typeof context.register>>();
  for (const [, object] of [...context.enumerateIndirectObjects()]) {
    if (!(object instanceof PDFDict)) continue;
    const mask = context.lookup(object.get(name("SMask")));
    if (
      !(mask instanceof PDFDict) ||
      mask.get(name("S")) !== name("Luminosity")
    )
      continue;
    const skip = () => {
      result.skipped += 1;
    };
    if (
      mask.has(name("TR")) ||
      mask
        .keys()
        .some((k) => !["/Type", "/S", "/G", "/BC"].includes(k.toString()))
    ) {
      skip();
      continue;
    }
    const backdrop = context.lookup(mask.get(name("BC")));
    const backdropValue =
      backdrop instanceof PDFArray && backdrop.size() === 1
        ? backdrop.lookup(0)
        : undefined;
    if (
      backdrop !== undefined &&
      (!(backdropValue instanceof PDFNumber) || backdropValue.asNumber() !== 0)
    ) {
      skip();
      continue;
    }
    const form = context.lookup(mask.get(name("G")));
    if (!(form instanceof PDFRawStream)) {
      skip();
      continue;
    }
    let replacement = forms.get(form);
    if (!replacement) {
      const group = context.lookup(form.dict.get(name("Group")));
      if (
        !(group instanceof PDFDict) ||
        group.get(name("CS")) !== name("DeviceGray") ||
        group.get(name("S")) !== name("Transparency") ||
        group.get(name("I")) !== PDFBool.True ||
        group.get(name("K")) === PDFBool.True
      ) {
        skip();
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = decodePDFRawStream(form).decode();
      } catch {
        skip();
        continue;
      }
      const match = recipe.exec(Buffer.from(bytes).toString("ascii"));
      const resources = context.lookup(form.dict.get(name("Resources")));
      if (!match || !(resources instanceof PDFDict)) {
        skip();
        continue;
      }
      const images = context.lookup(resources.get(name("XObject")));
      const states = context.lookup(resources.get(name("ExtGState")));
      const state =
        states instanceof PDFDict
          ? context.lookup(states.get(name(match[1])))
          : undefined;
      if (
        !(images instanceof PDFDict) ||
        images.keys().length !== 1 ||
        !(state instanceof PDFDict)
      ) {
        skip();
        continue;
      }
      // Opacity, transfer functions, blend modes and nested masks would change
      // luminosity/alpha equivalence. Accept only neutral paint state.
      const neutral = state.entries().every(([key, value]) => {
        const v = context.lookup(value);
        if (["/ca", "/CA"].includes(key.toString()))
          return v instanceof PDFNumber && v.asNumber() === 1;
        if (key === name("BM")) return v === name("Normal");
        if (key === name("Type")) return v === name("ExtGState");
        return false;
      });
      const imageRef = images.get(name(match[2]));
      const image = context.lookup(imageRef);
      if (
        !neutral ||
        !(image instanceof PDFRawStream) ||
        image.dict.get(name("Subtype")) !== name("Image") ||
        image.dict.get(name("ColorSpace")) !== name("DeviceGray") ||
        ["SMask", "Mask", "Decode", "ImageMask"].some((k) =>
          image.dict.has(name(k)),
        )
      ) {
        skip();
        continue;
      }
      const width = image.dict.lookup(name("Width"));
      const height = image.dict.lookup(name("Height"));
      const bits = image.dict.lookup(name("BitsPerComponent"));
      if (
        !(width instanceof PDFNumber) ||
        !(height instanceof PDFNumber) ||
        !(bits instanceof PDFNumber) ||
        bits.asNumber() !== 8
      ) {
        skip();
        continue;
      }
      const w = width.asNumber(),
        h = height.asNumber();
      if (
        !Number.isSafeInteger(w) ||
        !Number.isSafeInteger(h) ||
        w < 1 ||
        h < 1 ||
        w * h > 64_000_000
      ) {
        skip();
        continue;
      }
      const white = context.flateStream(new Uint8Array(w * h).fill(255), {
        Type: "XObject",
        Subtype: "Image",
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
        Width: w,
        Height: h,
        SMask: imageRef,
      });
      const nextImages = images.clone();
      nextImages.set(name(match[2]), context.register(white));
      const nextResources = resources.clone();
      nextResources.set(name("XObject"), nextImages);
      const nextForm = form.clone();
      nextForm.dict.set(name("Resources"), nextResources);
      replacement = context.register(nextForm);
      forms.set(form, replacement);
    }
    const nextMask = mask.clone();
    nextMask.set(name("S"), name("Alpha"));
    nextMask.set(name("G"), replacement);
    object.set(name("SMask"), nextMask);
    result.converted += 1;
  }
  return result;
}
