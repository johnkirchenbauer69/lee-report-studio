import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test("managed Nunito Sans resolves, loads, and never exposes a raw CSS family textbox", async ({
  page,
}) => {
  const assetResponse = await page.request.get("/api/assets");
  test.skip(
    !assetResponse.ok(),
    "The managed asset API is not running in this environment.",
  );
  const assets = (await assetResponse.json()) as {
    assets: Array<{
      fontFamily?: string;
      fontWeight?: number;
      fontStyle?: string;
    }>;
  };
  const faces = assets.assets.filter(
    (asset) => asset.fontFamily === "Nunito Sans",
  );
  test.skip(
    faces.length === 0,
    "The local managed font store is intentionally not committed; runtime verification requires the imported Nunito bundle.",
  );
  expect(faces).toHaveLength(14);
  expect(faces.map((face) => [face.fontWeight, face.fontStyle]).sort()).toEqual(
    [300, 400, 500, 600, 700, 800, 900]
      .flatMap((weight) => [
        [weight, "normal"],
        [weight, "italic"],
      ])
      .sort(),
  );

  await page.goto("/", { waitUntil: "load" });
  await page.locator(".rail").getByTitle("Fonts").click();
  const nunitoCard = page
    .locator(".font-family-card")
    .filter({ has: page.locator("header strong", { hasText: "Nunito Sans" }) });
  await expect(nunitoCard.locator(".font-family-status")).toContainText(
    "14/14 loaded",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /Templates/ }).click();
  await page.getByRole("button", { name: "Market Highlights" }).click();
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /TOP AVAILABILITIES.*text/i })
    .click();

  const typography = page
    .locator(".inspector-section")
    .filter({ hasText: "Typography" });
  await expect(typography.getByLabel("Font family")).toHaveValue("Nunito Sans");
  await expect(typography.getByLabel("Weight").locator("option")).toHaveCount(
    7,
  );
  await expect(
    typography.getByLabel("Font style").locator("option"),
  ).toHaveCount(2);
  await expect(typography.locator(".font-resolution")).toContainText(
    "Managed · Loaded ✓",
  );
  await expect(typography.locator('input[aria-label*="font" i]')).toHaveCount(
    0,
  );

  const runtime = await page
    .locator(".canvas-element.is-selected")
    .evaluate((node) => {
      const computed = getComputedStyle(node);
      const descriptor = `normal 400 12px "Nunito Sans"`;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.font = '400 32px "Nunito Sans"';
      const managedWidth = context.measureText(
        "Industrial Market Report",
      ).width;
      context.font = '400 32px "Times New Roman"';
      const serifWidth = context.measureText("Industrial Market Report").width;
      return {
        available: document.fonts.check(
          descriptor,
          "LEE managed font verification",
        ),
        family: computed.fontFamily,
        sansGeneric: computed.fontFamily
          .toLocaleLowerCase()
          .includes("sans-serif"),
        widthDelta: Math.abs(managedWidth - serifWidth),
      };
    });
  expect(runtime.available).toBe(true);
  expect(runtime.family).toContain("Nunito Sans");
  expect(runtime.sansGeneric).toBe(true);
  expect(runtime.widthDelta).toBeGreaterThan(5);
});

test("representative imported families populate semantic controls and render in Chromium PDF", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const assetResponse = await page.request.get("/api/assets");
  test.skip(!assetResponse.ok(), "The managed asset API is not running.");
  const payload = (await assetResponse.json()) as {
    assets: Array<{
      id: string;
      name: string;
      type: string;
      mimeType: string;
      source: string;
      createdAt: string;
      fontFamily?: string;
      fontWeight?: number;
      fontStyle?: "normal" | "italic";
      checksum?: string;
      storage?: "backend";
      license?: { type?: string; fileName?: string };
      version?: number;
    }>;
  };
  const fonts = payload.assets.filter((asset) => asset.type === "font");
  const expectedFamilies = [
    ["Cooper Hewitt", 7],
    ["Metropolis", 9],
    ["Open Sans Condensed", 2],
    ["Odin Rounded", 3],
  ] as const;
  test.skip(
    expectedFamilies.some(
      ([family]) => !fonts.some((font) => font.fontFamily === family),
    ),
    "Representative attached font bundles are not installed locally.",
  );

  const facesFor = (family: string) =>
    fonts.filter((font) => font.fontFamily === family);
  const nunitoFaces = facesFor("Nunito");
  expect(nunitoFaces).toHaveLength(14);
  expect(new Set(nunitoFaces.map((face) => face.checksum)).size).toBe(14);
  expect(
    facesFor("Ubuntu").length +
      facesFor("Ubuntu Condensed").length +
      facesFor("Ubuntu Monospaced").length,
  ).toBe(22);
  expect(facesFor("Ubuntu Condensed")).toHaveLength(2);
  expect(facesFor("Ubuntu Monospaced")).toHaveLength(4);
  expect(
    facesFor("Open Sans Condensed").every(
      (face) => face.license?.type === "Apache License 2.0",
    ),
  ).toBe(true);
  expect(
    facesFor("Metropolis").every(
      (face) => face.license?.type === "SIL Open Font License 1.1",
    ),
  ).toBe(true);
  expect(facesFor("Odin Rounded").every((face) => !face.license?.type)).toBe(
    true,
  );

  await page.goto("/", { waitUntil: "load" });
  await page.locator(".rail").getByTitle("Fonts").click();
  const cooperCard = page.locator(".font-family-card").filter({
    has: page.locator("header strong", { hasText: "Cooper Hewitt" }),
  });
  await expect(cooperCard.locator(".font-family-status")).toContainText(
    "14/14 loaded",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /Templates/ }).click();
  await page.getByRole("button", { name: "Market Highlights" }).click();
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /TOP AVAILABILITIES.*text/i })
    .click();
  const typography = page
    .locator(".inspector-section")
    .filter({ hasText: "Typography" });
  const familyPicker = typography.getByLabel("Font family");
  const familyOptions = await familyPicker
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  for (const [family, weightCount] of expectedFamilies) {
    expect(familyOptions).toContain(family);
    await familyPicker.selectOption(family);
    await expect(typography.locator(".font-resolution")).toContainText(
      "Managed · Loaded ✓",
      { timeout: 20_000 },
    );
    await expect(typography.getByLabel("Weight").locator("option")).toHaveCount(
      weightCount,
    );
  }
  await familyPicker.selectOption("Open Sans Condensed");
  await typography.getByLabel("Weight").selectOption("700");
  await expect(
    typography.getByLabel("Font style").locator("option"),
  ).toHaveCount(1);
  await expect(typography.getByLabel("Font style")).toHaveValue("normal");

  const exactFaceChecks = await page.evaluate(
    (assets) => {
      const alias = (id: string) =>
        `LEE Managed ${id.replace(/[^a-z0-9-]/gi, "")}`;
      return assets.map((asset) => ({
        family: asset.fontFamily,
        loaded: document.fonts.check(
          `${asset.fontStyle ?? "normal"} ${asset.fontWeight ?? 400} 12px "${alias(asset.id)}"`,
          "LEE exact managed face",
        ),
      }));
    },
    [
      fonts.find(
        (font) =>
          font.fontFamily === "Cooper Hewitt" &&
          font.fontWeight === 400 &&
          font.fontStyle === "normal",
      )!,
      fonts.find(
        (font) =>
          font.fontFamily === "Metropolis" &&
          font.fontWeight === 400 &&
          font.fontStyle === "normal",
      )!,
      fonts.find(
        (font) =>
          font.fontFamily === "Open Sans Condensed" &&
          font.fontWeight === 300 &&
          font.fontStyle === "normal",
      )!,
      fonts.find(
        (font) =>
          font.fontFamily === "Odin Rounded" &&
          font.fontWeight === 400 &&
          font.fontStyle === "normal",
      )!,
    ],
  );
  expect(exactFaceChecks.every((check) => check.loaded)).toBe(true);

  await page.locator(".rail").getByTitle("Fonts").click();
  for (const [family] of expectedFamilies) {
    const card = page
      .locator(".font-family-card")
      .filter({ has: page.locator("header strong", { hasText: family }) });
    await expect(card.locator(".font-family-preview")).toHaveCSS(
      "font-family",
      new RegExp(family),
    );
    await expect(card.locator(".font-family-status")).toContainText("loaded");
    await expect(card.locator(".font-family-status")).toContainText("License:");
  }
  await expect(
    page
      .locator(".font-family-card")
      .filter({ has: page.locator("header strong", { hasText: "Metropolis" }) })
      .locator(".font-family-status"),
  ).toContainText("License: SIL Open Font License 1.1");
  await expect(
    page
      .locator(".font-family-card")
      .filter({
        has: page.locator("header strong", {
          hasText: "Open Sans Condensed",
        }),
      })
      .locator(".font-family-status"),
  ).toContainText("License: Apache License 2.0");
  await expect(
    page
      .locator(".font-family-card")
      .filter({
        has: page.locator("header strong", { hasText: "Odin Rounded" }),
      })
      .locator(".font-family-status"),
  ).toContainText("License: Not provided · Unverified");
  await expect(
    page
      .locator(".font-family-card")
      .filter({
        has: page.locator("header strong", { hasText: "Flamante Round" }),
      })
      .locator(".font-family-status"),
  ).toContainText("FREE_FOR_PERSONAL_USE_ONLY.pdf");

  const representative = exactFaceChecks.map(
    (_, index) =>
      [
        fonts.find(
          (font) =>
            font.fontFamily === "Cooper Hewitt" &&
            font.fontWeight === 400 &&
            font.fontStyle === "normal",
        ),
        fonts.find(
          (font) =>
            font.fontFamily === "Metropolis" &&
            font.fontWeight === 400 &&
            font.fontStyle === "normal",
        ),
        fonts.find(
          (font) =>
            font.fontFamily === "Open Sans Condensed" &&
            font.fontWeight === 300 &&
            font.fontStyle === "normal",
        ),
        fonts.find(
          (font) =>
            font.fontFamily === "Odin Rounded" &&
            font.fontWeight === 400 &&
            font.fontStyle === "normal",
        ),
      ][index]!,
  );
  const template = {
    id: "managed-font-pdf-acceptance",
    name: "Managed Font PDF Acceptance",
    version: "1.0.0",
    assets: representative,
    pages: [
      {
        id: "fonts",
        name: "Managed Fonts",
        width: 612,
        height: 792,
        background: "#ffffff",
        elements: representative.map((asset, index) => ({
          id: `font-${index}`,
          type: "text",
          name: `${asset.fontFamily} sample`,
          x: 48,
          y: 70 + index * 120,
          width: 516,
          height: 70,
          text: `${asset.fontFamily}: The quick brown fox jumps over the lazy dog.`,
          style: {
            typography: {
              fontFamily: asset.fontFamily!,
              fontWeight: asset.fontWeight ?? 400,
              fontStyle: asset.fontStyle ?? "normal",
              fontAssetId: asset.id,
              fontChecksum: asset.checksum,
              fontSize: 24,
              color: "#172033",
              letterSpacing: 0,
              lineHeight: 1.2,
              textAlign: "left",
              verticalAlign: "top",
              italic: false,
              underline: false,
            },
          },
        })),
      },
    ],
  };
  const pdfResponse = await page.request.post("/api/render/pdf", {
    data: { template, data: {}, title: template.name },
    timeout: 90_000,
  });
  expect(pdfResponse.ok()).toBe(true);
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
  const pdf = await PDFDocument.load(await pdfResponse.body());
  expect(pdf.getPageCount()).toBe(1);
});
