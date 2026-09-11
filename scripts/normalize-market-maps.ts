import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAP_SOURCE_FRAME_CROP_PX = 32;
export const MAP_DERIVATIVE_WIDTH_PX = 1800;
export const MAP_DERIVATIVE_JPEG_QUALITY = 90;

const sourceRoot = path.resolve("public/report-assets/maps");
const outputRoot = path.join(sourceRoot, "normalized");
const checksum = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

await mkdir(outputRoot, { recursive: true });
const files = (await readdir(sourceRoot))
  .filter(
    (file) => file.endsWith("_Map.jpg") && file !== "Overall_Market_Map.jpg",
  )
  .sort();

const derivatives = [];
for (const file of files) {
  const sourcePath = path.join(sourceRoot, file);
  const source = await readFile(sourcePath);
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height)
    throw new Error(`${file} has no decodable dimensions.`);
  if (metadata.width <= MAP_SOURCE_FRAME_CROP_PX * 2)
    throw new Error(`${file} is too narrow for governed frame removal.`);
  const outputHeight = Math.round(
    (metadata.height * MAP_DERIVATIVE_WIDTH_PX) / metadata.width,
  );
  const output = await sharp(source, { failOn: "error" })
    .extract({
      left: MAP_SOURCE_FRAME_CROP_PX,
      top: 0,
      width: metadata.width - MAP_SOURCE_FRAME_CROP_PX * 2,
      height: metadata.height,
    })
    .resize({
      width: MAP_DERIVATIVE_WIDTH_PX,
      height: outputHeight,
      fit: "fill",
    })
    .jpeg({
      quality: MAP_DERIVATIVE_JPEG_QUALITY,
      chromaSubsampling: "4:4:4",
      progressive: true,
      mozjpeg: true,
    })
    .toBuffer();
  await writeFile(path.join(outputRoot, file), output);
  derivatives.push({
    file,
    source: {
      checksum: checksum(source),
      width: metadata.width,
      height: metadata.height,
      bytes: source.length,
    },
    normalization: {
      leftCropPx: MAP_SOURCE_FRAME_CROP_PX,
      rightCropPx: MAP_SOURCE_FRAME_CROP_PX,
      outputWidth: MAP_DERIVATIVE_WIDTH_PX,
      outputHeight,
      format: "jpeg",
      quality: MAP_DERIVATIVE_JPEG_QUALITY,
    },
    derivative: {
      checksum: checksum(output),
      bytes: output.length,
    },
  });
}

await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify({ version: 1, derivatives }, null, 2)}\n`,
  "utf8",
);
console.log(`Normalized ${derivatives.length} governed submarket maps.`);
