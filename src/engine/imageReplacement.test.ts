import { describe, expect, it } from "vitest";
import type { Asset, ImageElement, ReportTemplate } from "../types/report";
import {
  replaceImageAsset,
  replaceTemplateImageAsset,
} from "./imageReplacement";

const asset: Asset = {
  id: "managed-replacement",
  name: "Replacement",
  type: "image",
  mimeType: "image/png",
  source: "/api/assets/managed-replacement/content",
  storage: "backend",
  createdAt: "2026-09-01T00:00:00.000Z",
};

const image: ImageElement = {
  id: "hero",
  type: "image",
  name: "Hero image",
  x: 17,
  y: 29,
  width: 311,
  height: 207,
  rotation: 37,
  locked: true,
  fit: "contain",
  crop: { x: 14, y: 83, zoom: 2.4 },
  sourceCrop: {
    sourceWidth: 1200,
    sourceHeight: 800,
    x: 100,
    y: 75,
    width: 900,
    height: 600,
  },
  src: "/old.png",
  assetId: "old",
  style: {
    opacity: 0.42,
    borderRadius: 9,
    stroke: {
      enabled: true,
      color: "#c4123f",
      width: 3,
      opacity: 1,
      style: "solid",
    },
  },
};

describe("managed image replacement", () => {
  it("changes only the managed asset reference and resets crop", () => {
    const replaced = replaceImageAsset(image, asset);

    expect(replaced).toEqual(
      expect.objectContaining({
        src: asset.source,
        assetId: asset.id,
        crop: { x: 50, y: 50, zoom: 1 },
      }),
    );
    expect(replaced).not.toHaveProperty("sourceCrop");
    expect(replaced).toMatchObject({
      id: "hero",
      name: "Hero image",
      x: 17,
      y: 29,
      width: 311,
      height: 207,
      rotation: 37,
      locked: true,
      fit: "contain",
      style: {
        opacity: 0.42,
        borderRadius: 9,
        stroke: {
          enabled: true,
          color: "#c4123f",
          width: 3,
          opacity: 1,
          style: "solid",
        },
      },
    });
  });

  it("replaces the same element on the same page without duplicating it", () => {
    const template: ReportTemplate = {
      id: "template",
      name: "Template",
      version: "1.0.0",
      pages: [
        {
          id: "page-a",
          name: "Page A",
          width: 816,
          height: 1056,
          background: "#fff",
          elements: [image],
        },
      ],
    };

    const replaced = replaceTemplateImageAsset(template, image.id, asset);

    expect(replaced.pages).toHaveLength(1);
    expect(replaced.pages[0].elements).toHaveLength(1);
    expect(replaced.pages[0].elements[0]).toMatchObject({
      id: image.id,
      assetId: asset.id,
      src: asset.source,
    });
  });
});
