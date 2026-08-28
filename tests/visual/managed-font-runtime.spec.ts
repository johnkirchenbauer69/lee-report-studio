import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const APPROVED_FAMILIES = [
  "Carrois Gothic",
  "Mada",
  "Metropolis",
  "Nunito",
  "Nunito Sans",
  "Open Sans Condensed",
  "Padauk",
  "Ubuntu",
  "Ubuntu Condensed",
  "Ubuntu Monospaced",
] as const;

const DISALLOWED_FAMILIES = [
  "Cooper Hewitt",
  "Flamante Round",
  "Odin Rounded",
  "RedWood",
  "RedWood Oblique",
  "RedWood Thick",
  "RedWood Thick Oblique",
  "Walrus",
] as const;

test("managed Nunito Sans resolves, loads, and never exposes a raw CSS family textbox", async ({
  page,
}) => {
  const assetResponse = await page.request.get("/api/assets");
  test.skip(!assetResponse.ok(), "The managed asset API is not running.");
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
  test.skip(!faces.length, "The local managed font store is not installed.");
  expect(faces).toHaveLength(14);

  await page.goto("/", { waitUntil: "load" });
  await page.locator(".rail").getByTitle("Fonts").click();
  const nunitoCard = page.locator(".font-family-card").filter({
    has: page.locator("header strong", { hasText: "Nunito Sans" }),
  });
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
  await expect(typography.locator(".font-resolution")).toContainText(
    "Managed · Loaded ✓",
  );
  await expect(typography.locator('input[aria-label*="font" i]')).toHaveCount(
    0,
  );
});

test("only approved families survive the runtime store, picker, and Chromium PDF path", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const response = await page.request.get("/api/assets");
  test.skip(!response.ok(), "The managed asset API is not running.");
  const payload = (await response.json()) as {
    assets: Array<{
      id: string;
      name: string;
      type: string;
      source: string;
      createdAt: string;
      mimeType: string;
      fontFamily?: string;
      fontWeight?: number;
      fontStyle?: "normal" | "italic";
      checksum?: string;
      fontGovernanceStatus?: string;
    }>;
  };
  const fonts = payload.assets.filter((asset) => asset.type === "font");
  const families = [...new Set(fonts.map((font) => font.fontFamily))].sort();
  test.skip(!fonts.length, "The local managed font store is not installed.");
  expect(families).toEqual([...APPROVED_FAMILIES].sort());
  expect(fonts).toHaveLength(81);
  expect(fonts.every((font) => font.fontGovernanceStatus === "approved")).toBe(
    true,
  );
  for (const family of DISALLOWED_FAMILIES)
    expect(families).not.toContain(family);

  await page.goto("/", { waitUntil: "load" });
  await page.locator(".rail").getByTitle("Fonts").click();
  await expect(page.locator(".font-family-card")).toHaveCount(10);
  for (const family of APPROVED_FAMILIES)
    await expect(
      page.locator(".font-family-card > header > strong", {
        hasText: new RegExp(
          `^${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ),
      }),
    ).toBeVisible();
  for (const family of DISALLOWED_FAMILIES)
    await expect(
      page.locator(".font-family-card > header > strong", {
        hasText: new RegExp(
          `^${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ),
      }),
    ).toHaveCount(0);

  await page.getByRole("button", { name: /Templates/ }).click();
  await page.getByRole("button", { name: "Market Highlights" }).click();
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /TOP AVAILABILITIES.*text/i })
    .click();
  const picker = page
    .locator(".inspector-section")
    .filter({ hasText: "Typography" })
    .getByLabel("Font family");
  const pickerOptions = await picker.locator("option").allTextContents();
  for (const family of APPROVED_FAMILIES)
    expect(pickerOptions).toContain(family);
  for (const family of DISALLOWED_FAMILIES)
    expect(pickerOptions).not.toContain(family);

  const representatives = [
    "Carrois Gothic",
    "Metropolis",
    "Open Sans Condensed",
    "Ubuntu",
  ]
    .map((family) => fonts.find((font) => font.fontFamily === family))
    .filter((font): font is (typeof fonts)[number] => Boolean(font));
  expect(representatives).toHaveLength(4);
  const template = {
    id: "approved-font-pdf-acceptance",
    name: "Approved Font PDF Acceptance",
    version: "1.0.0",
    assets: representatives,
    pages: [
      {
        id: "fonts",
        name: "Approved Fonts",
        width: 612,
        height: 792,
        background: "#ffffff",
        elements: representatives.map((asset, index) => ({
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
  const pdf = await PDFDocument.load(await pdfResponse.body());
  expect(pdf.getPageCount()).toBe(1);
});
