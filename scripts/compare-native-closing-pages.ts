import sharp from "sharp";

const root = process.argv[2] ?? "output/design-consistency";
for (const name of ["data-methodology", "definitions", "contacts", "who-we-are"]) {
  await sharp({ create: { width: 1224, height: 792, channels: 3, background: "white" } })
    .composite([
      { input: `${root}/reference-${name}.png`, left: 0, top: 0 },
      { input: `${root}/pdf-${name}.png`, left: 612, top: 0 },
    ]).png().toFile(`${root}/comparison-${name}.png`);
}
console.log("Created equal-scale comparisons: supplied reference left, exported native page right.");
