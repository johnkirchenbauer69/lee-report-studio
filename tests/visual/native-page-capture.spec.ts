import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { sampleData } from "../../src/data/sampleData";

test("native capture mounts one frozen page while ordinary PDF rendering retains every page", async ({ page }) => {
  const template = { ...sampleTemplate, pages: sampleTemplate.pages.slice(-4) };
  await page.route("**/api/render-jobs/paged", (route) => route.fulfill({
    json: { template, data: sampleData, title: "Paged native capture" },
  }));
  await page.goto("/?printJob=paged&nativeCapture=1");
  await expect(page.locator('[data-render-ready="true"]')).toBeVisible();
  await expect(page.locator("section.print-page")).toHaveCount(1);
  for (const index of [2, 3, 0]) {
    await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("lee:native-page", { detail })), index);
    await expect(page.locator(".print-document")).toHaveAttribute("data-native-page", String(index));
    await expect(page.locator("section.print-page")).toHaveCount(1);
    await expect(page.locator("section.print-page")).toHaveAttribute("data-page-id", template.pages[index]!.id);
    const pdf = await PDFDocument.load(await page.pdf({ format: "Letter", printBackground: true }));
    expect(pdf.getPageCount()).toBe(1);
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lee:native-page", { detail: 99 })));
  await expect(page.locator(".print-document")).toHaveAttribute("data-native-page", "0");
  await page.goto("/?printJob=paged");
  await expect(page.locator('[data-render-ready="true"]')).toBeVisible();
  await expect(page.locator("section.print-page")).toHaveCount(4);
});
