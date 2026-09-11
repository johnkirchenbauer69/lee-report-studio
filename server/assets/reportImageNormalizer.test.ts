import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  MAX_REPORT_IMAGE_SOURCE_BYTES,
  REPORT_IMAGE_OUTPUT_HEIGHT,
  REPORT_IMAGE_OUTPUT_MAX_BYTES,
  REPORT_IMAGE_OUTPUT_WIDTH,
  normalizeOversizedReportImage,
  ReportImageNormalizationError,
} from "./reportImageNormalizer";

const photographicFixture = () =>
  sharp({
    create: {
      width: 2_400,
      height: 1_600,
      channels: 3,
      background: { r: 92, g: 132, b: 164 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();

describe("bounded report-image normalization", () => {
  it("downsamples and recompresses an oversized photographic source into JPEG", async () => {
    const image = await photographicFixture();
    const oversized = Buffer.concat([
      image,
      Buffer.alloc(16 * 1024 * 1024 - image.length + 1),
    ]);
    const result = await normalizeOversizedReportImage({
      buffer: oversized,
      mimeType: "image/jpeg",
    });
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.buffer.length).toBeLessThan(REPORT_IMAGE_OUTPUT_MAX_BYTES);
    expect(result.derivative).toMatchObject({
      kind: "normalized-salesforce-report-image",
      sourceType: "salesforce",
      sourceSize: oversized.length,
      outputFormat: "jpeg",
    });
    expect(result.derivative.outputWidth).toBeLessThanOrEqual(
      REPORT_IMAGE_OUTPUT_WIDTH,
    );
    expect(result.derivative.outputHeight).toBeLessThanOrEqual(
      REPORT_IMAGE_OUTPUT_HEIGHT,
    );
  });

  it("rejects malformed and unsupported oversized inputs safely", async () => {
    await expect(
      normalizeOversizedReportImage({
        buffer: Buffer.alloc(16 * 1024 * 1024, 7),
        mimeType: "image/jpeg",
      }),
    ).rejects.toBeInstanceOf(ReportImageNormalizationError);
    await expect(
      normalizeOversizedReportImage({
        buffer: Buffer.alloc(16 * 1024 * 1024, 7),
        mimeType: "image/gif",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
  });

  it("enforces source-byte and decoded-dimension guards", async () => {
    await expect(
      normalizeOversizedReportImage({
        buffer: Buffer.alloc(MAX_REPORT_IMAGE_SOURCE_BYTES + 1),
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    const tooWide = await sharp({
      create: {
        width: 12_001,
        height: 1,
        channels: 3,
        background: "white",
      },
    })
      .jpeg()
      .toBuffer();
    await expect(
      normalizeOversizedReportImage({
        buffer: tooWide,
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "DECODE_LIMIT" });
  });
});
