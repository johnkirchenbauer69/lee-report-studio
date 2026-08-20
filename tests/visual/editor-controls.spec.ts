import { expect, test } from "@playwright/test";

test("text vertical alignment and color controls update the canvas", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });
  await page.getByRole("button", { name: /Templates/ }).click();
  await page.getByRole("button", { name: "Market Highlights" }).click();
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /TOP AVAILABILITIES.*text/i })
    .click();

  const positionSection = page
    .locator(".inspector-section")
    .filter({ hasText: "Position & Size" });
  await positionSection.getByLabel(/^W/).fill("752");
  await positionSection.getByLabel(/^H/).fill("27");

  await page.getByTitle("Vertically align text middle").click();

  const selected = page.locator(".canvas-element.is-selected");
  await expect(selected.locator(".text-content")).toHaveClass(
    /vertical-middle/,
  );
  await expect(selected.locator(".text-content")).toHaveCSS(
    "align-items",
    "center",
  );

  await page.getByLabel("Text color picker").fill("#00ff00");
  await expect(selected).toHaveCSS("color", "rgb(0, 255, 0)");

  await page.getByLabel("Color picker", { exact: true }).fill("#123456");
  await expect(selected).toHaveCSS("background-color", "rgb(18, 52, 86)");
});
