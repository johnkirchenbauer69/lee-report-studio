import { expect, test } from "@playwright/test";

async function openPeriodStep(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(
    page.locator(".topbar .brand > div:last-child > span"),
  ).not.toContainText("local recovery");
  await page.locator(".create-report-top").click();
  const dialog = page.getByRole("dialog", { name: "Create report" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
  return dialog;
}

test("Report Period uses the explicit mock discovery fixture and keeps Chicago read-only", async ({
  page,
}) => {
  const dialog = await openPeriodStep(page);
  const period = dialog.getByLabel("Report period");
  await expect(period).toBeEnabled();
  await expect(period.locator("option")).toHaveText([
    "2026 Q3",
    "2026 Q2",
    "2026 Q1",
    "2025 Q4",
  ]);
  await expect(period).toHaveValue("2026 Q2");
  await period.selectOption("2026 Q3");
  await expect(period).toHaveValue("2026 Q3");
  await expect(dialog.getByLabel("Market")).toHaveValue("Chicago");
  await expect(dialog.getByLabel("Market")).toHaveAttribute("readonly", "");
});

test("Report Period shows Salesforce failure without a hard-coded fallback", async ({
  page,
}) => {
  await page.route("**/api/report-data/industrial-market/periods", (route) =>
    route.fulfill({ status: 503, body: "Salesforce unavailable" }),
  );
  const dialog = await openPeriodStep(page);
  await expect(
    dialog.getByText("Available report periods could not be loaded."),
  ).toBeVisible();
  await expect(dialog.getByLabel("Report period")).toBeDisabled();
  await expect(dialog.getByLabel("Report period").locator("option")).toHaveText(
    ["Periods unavailable"],
  );
});
