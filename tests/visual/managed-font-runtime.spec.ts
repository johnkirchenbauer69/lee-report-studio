import { expect, test } from "@playwright/test";

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
