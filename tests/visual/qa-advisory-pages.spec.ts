import { expect, test } from "@playwright/test";
import { sampleTemplate } from "../../src/data/sampleTemplate";

test("Pages is a dedicated, independently scrollable navigation panel", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });

  const navTitles = await page
    .locator(".rail > button")
    .evaluateAll((buttons) => buttons.map((button) => button.title));
  expect(navTitles).toEqual([
    "Templates",
    "Pages",
    "Elements",
    "Text",
    "Images",
    "Uploads",
    "Fonts",
    "Data",
    "QA",
  ]);

  await page.locator(".rail").getByTitle("Templates").click();
  await expect(page.locator(".template-version-list")).toBeVisible();
  await expect(page.locator(".page-list")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save As New Version" }),
  ).toBeVisible();

  await page.locator(".rail").getByTitle("Pages").click();
  const pageButtons = page.locator(".page-list > button");
  await expect(pageButtons).toHaveCount(sampleTemplate.pages.length);
  await expect(page.locator(".page-list")).toHaveCSS("overflow-y", "auto");
  const independentlyScrollable = await page
    .locator(".page-list")
    .evaluate((list) => list.scrollHeight > list.clientHeight);
  expect(independentlyScrollable).toBe(true);

  const target = pageButtons.nth(Math.min(5, sampleTemplate.pages.length - 1));
  const targetName = (await target.locator(":scope > span").textContent())!;
  await target.click();
  await expect(target).toHaveClass(/active/);
  await expect(page.locator(".stage-topline span").first()).toHaveText(
    targetName,
  );

  await page.locator(".rail").getByTitle("Templates").click();
  await page.locator(".rail").getByTitle("Pages").click();
  await expect(pageButtons.filter({ hasText: targetName }).first()).toHaveClass(
    /active/,
  );
});

test("warnings can be reviewed or explicitly accepted without individual dismissal", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/", { waitUntil: "load" });

  await page.getByRole("button", { name: "Export PDF" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Export PDF with QA warnings",
  });
  await expect(dialog).toBeVisible();
  const message = await dialog.locator("p").textContent();
  const warningCount = Number(message?.match(/has (\d+) QA warning/)?.[1]);
  expect(warningCount).toBeGreaterThan(0);

  await dialog.getByRole("button", { name: "Review warnings" }).click();
  await expect(
    page.locator(".validation-panel .panel-heading span"),
  ).toHaveText(`0 blocking · ${warningCount} warnings`);
  const selectableWarning = page
    .locator(".warning-group .validation-row")
    .filter({ has: page.getByRole("button", { name: "Select" }) })
    .first();
  await selectableWarning.getByRole("button", { name: "Select" }).click();
  await expect(page.locator(".rail").getByTitle("Elements")).toHaveClass(
    /active/,
  );
  await expect(page.locator(".canvas-element.is-selected")).toHaveCount(1);

  await page.getByRole("button", { name: "Export PDF" }).click();
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await dialog.getByRole("button", { name: "Export anyway" }).click();
  await download;
});
