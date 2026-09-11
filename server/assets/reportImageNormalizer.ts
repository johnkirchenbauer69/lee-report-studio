import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Asset } from "../../src/types/report.ts";

export const MAX_REPORT_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_REPORT_IMAGE_SOURCE_DIMENSION = 12_000;
export const MAX_REPORT_IMAGE_INPUT_PIXELS = 40_000_000;
export const REPORT_IMAGE_DECODE_TIMEOUT_MS = 10_000;
export const REPORT_IMAGE_OUTPUT_WIDTH = 1_600;
export const REPORT_IMAGE_OUTPUT_HEIGHT = 1_200;
export const REPORT_IMAGE_OUTPUT_TARGET_BYTES = 1_500_000;
export const REPORT_IMAGE_OUTPUT_MAX_BYTES = 3 * 1024 * 1024;

const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const supportedFormats = new Set(["jpeg", "png", "webp"]);

export class ReportImageNormalizationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "SOURCE_TOO_LARGE"
      | "UNSUPPORTED_TYPE"
      | "INVALID_IMAGE"
      | "DECODE_LIMIT"
      | "DECODE_TIMEOUT"
      | "OUTPUT_TOO_LARGE",
  ) {
    super(message);
    this.name = "ReportImageNormalizationError";
  }
}

const withTimeout = <T>(operation: Promise<T>, label: string) =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new ReportImageNormalizationError(
            `${label} exceeded the report-image decode timeout.`,
            "DECODE_TIMEOUT",
          ),
        ),
      REPORT_IMAGE_DECODE_TIMEOUT_MS,
    );
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });

const normalizer = (buffer: Buffer) =>
  sharp(buffer, {
    failOn: "error",
    limitInputPixels: MAX_REPORT_IMAGE_INPUT_PIXELS,
    sequentialRead: true,
  });

export interface NormalizedReportImage {
  buffer: Buffer;
  mimeType: "image/jpeg";
  derivative: NonNullable<Asset["derivative"]>;
}

export async function normalizeOversizedReportImage(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<NormalizedReportImage> {
  const mimeType = input.mimeType.split(";", 1)[0]!.trim().toLowerCase();
  if (input.buffer.length > MAX_REPORT_IMAGE_SOURCE_BYTES)
    throw new ReportImageNormalizationError(
      "Source exceeds the bounded report-image normalization limit.",
      "SOURCE_TOO_LARGE",
    );
  if (!supportedMimeTypes.has(mimeType))
    throw new ReportImageNormalizationError(
      "Source MIME type is not supported for report-image normalization.",
      "UNSUPPORTED_TYPE",
    );

  let metadata;
  try {
    metadata = await withTimeout(
      normalizer(input.buffer).metadata(),
      "Image metadata decode",
    );
  } catch (error) {
    if (error instanceof ReportImageNormalizationError) throw error;
    throw new ReportImageNormalizationError(
      "Source could not be decoded as a supported image.",
      "INVALID_IMAGE",
    );
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    !supportedFormats.has(metadata.format ?? "") ||
    !width ||
    !height ||
    (metadata.pages ?? 1) !== 1
  )
    throw new ReportImageNormalizationError(
      "Source is malformed, animated, or uses an unsupported image format.",
      "INVALID_IMAGE",
    );
  if (
    width > MAX_REPORT_IMAGE_SOURCE_DIMENSION ||
    height > MAX_REPORT_IMAGE_SOURCE_DIMENSION ||
    width * height > MAX_REPORT_IMAGE_INPUT_PIXELS
  )
    throw new ReportImageNormalizationError(
      "Source dimensions exceed bounded report-image decode limits.",
      "DECODE_LIMIT",
    );

  const attempts = [
    {
      width: REPORT_IMAGE_OUTPUT_WIDTH,
      height: REPORT_IMAGE_OUTPUT_HEIGHT,
      quality: 84,
    },
    {
      width: REPORT_IMAGE_OUTPUT_WIDTH,
      height: REPORT_IMAGE_OUTPUT_HEIGHT,
      quality: 76,
    },
    { width: 1_280, height: 960, quality: 72 },
  ] as const;
  let latest:
    | {
        data: Buffer;
        info: { width: number; height: number; size: number };
        quality: number;
      }
    | undefined;
  for (const attempt of attempts) {
    try {
      const result = await withTimeout(
        normalizer(input.buffer)
          .rotate()
          .flatten({ background: "#ffffff" })
          .resize({
            width: attempt.width,
            height: attempt.height,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: attempt.quality, progressive: true, mozjpeg: true })
          .toBuffer({ resolveWithObject: true }),
        "Image normalization",
      );
      latest = { ...result, quality: attempt.quality };
    } catch (error) {
      if (error instanceof ReportImageNormalizationError) throw error;
      throw new ReportImageNormalizationError(
        "Source failed during bounded report-image decoding.",
        "INVALID_IMAGE",
      );
    }
    if (latest.data.length <= REPORT_IMAGE_OUTPUT_TARGET_BYTES) break;
  }
  if (!latest || latest.data.length > REPORT_IMAGE_OUTPUT_MAX_BYTES)
    throw new ReportImageNormalizationError(
      "Normalized derivative exceeds the report-image output limit.",
      "OUTPUT_TOO_LARGE",
    );

  return {
    buffer: latest.data,
    mimeType: "image/jpeg",
    derivative: {
      kind: "normalized-salesforce-report-image",
      sourceType: "salesforce",
      sourceMimeType: mimeType,
      sourceSize: input.buffer.length,
      sourceChecksum: createHash("sha256").update(input.buffer).digest("hex"),
      originalWidth: width,
      originalHeight: height,
      outputFormat: "jpeg",
      outputWidth: latest.info.width,
      outputHeight: latest.info.height,
      outputSize: latest.data.length,
      quality: latest.quality,
    },
  };
}
