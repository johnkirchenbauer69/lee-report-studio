import { expect, test } from "@playwright/test";
import { CANONICAL_TEMPLATES } from "../../src/report-engine/canonicalTemplates";
import { sampleTemplate } from "../../src/data/sampleTemplate";

test("canonical choice pins the selected family and defaults to all 18 details", async ({ page }, testInfo) => {
  // UI acceptance fixture only. No production publication or Salesforce query.
  const records = CANONICAL_TEMPLATES.map(family => ({ id: family.id, name: family.name, version: "1.0.0", status: "published",
    templateType: "industrial-market-report", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z",
    checksum: "fixture", revision: 0, pageDefinitionCount: 10, managedFontReferences: [], assetReferences: [],
    template: { ...sampleTemplate, id: family.id, name: family.name, version: "1.0.0" } }));
  await page.route("**/api/templates", async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ json: { ...body, templates: [...body.templates, ...records] } });
  });
  await page.route("**/api/templates/industrial-market-*/versions/1.0.0", async route => {
    const record = records.find(item => route.request().url().includes(`/${item.id}/`));
    if (!record) return route.continue();
    await route.fulfill({ json: record });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Create New Report", exact: true }).click();
  const choices = page.getByRole("radiogroup", { name: "Report template" });
  await expect(choices.getByRole("radio")).toHaveCount(2);
  await expect(choices.getByRole("img", { name: "Classic design sample" })).toBeVisible();
  await expect(choices.getByRole("img", { name: "Geographic design sample" })).toBeVisible();
  await choices.getByRole("radio", { name: /Industrial Market Report: Geographic/ }).click();
  await expect(choices.getByRole("radio", { name: /Geographic/ })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: testInfo.outputPath("template-choices.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Report period", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".source-options .selected")).toContainText("Ascendix");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("18 detailed pages", { exact: true })).toBeVisible();
});
