import { expect, test, type Page } from "@playwright/test";

// Runs before the destructive Phase 1B source-draft deletion acceptance.

const topbar = (page: Page) => page.locator(".topbar");
const pageButtons = (page: Page) => page.locator(".page-list > button");

async function ensureDraft(page: Page) {
  const save = topbar(page).getByRole("button", { name: "Save", exact: true });
  if (await save.isDisabled()) {
    await topbar(page).getByRole("button", { name: "Save as version" }).click();
    await expect(save).toBeEnabled();
  }
}

async function selectCoverImage(page: Page) {
  await page.getByRole("button", { name: "Templates" }).click();
  await pageButtons(page).filter({ hasText: "Cover" }).first().click();
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /Chicago Skyline.*image/i })
    .click();
}

async function clickTransientModeButton(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  // Autosave can replace the inspector between Playwright's stability checks.
  // A forced click still uses the live accessible control without waiting on
  // an inspector node that is intentionally short-lived.
  await button.click({ force: true });
}

test("crop and table edit modes reset across page navigation and Escape", async ({
  page,
}) => {
  // Earlier editor suites can leave several template versions for the initial
  // repository hydration to resolve. Wait for that load to finish before
  // selecting an element so it cannot be replaced by the hydrated document.
  await page.goto("/", { waitUntil: "networkidle" });
  await ensureDraft(page);

  await selectCoverImage(page);
  await clickTransientModeButton(page, "Crop image");
  await expect(page.locator(".canvas-element.is-cropping")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".canvas-element.is-cropping")).toHaveCount(0);
  await expect(page.locator(".canvas-element.is-selected")).toHaveCount(1);

  await clickTransientModeButton(page, "Crop image");
  await page.getByRole("button", { name: "Templates" }).click();
  await pageButtons(page).nth(1).click();
  await expect(page.locator(".canvas-element.is-cropping")).toHaveCount(0);

  await pageButtons(page).nth(0).click();
  await selectCoverImage(page);
  await clickTransientModeButton(page, "Crop image");
  await page.getByRole("button", { name: "Templates" }).click();
  await pageButtons(page).nth(1).click();
  await pageButtons(page).nth(0).click();
  await expect(page.locator(".canvas-element.is-cropping")).toHaveCount(0);

  await pageButtons(page)
    .filter({ hasText: "Overall Market Table" })
    .first()
    .click();
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /Submarket Metrics.*table/i })
    .click();
  await clickTransientModeButton(page, "Edit table");
  await expect(page.locator(".canvas-element.is-table-editing")).toHaveCount(1);
  await page.getByRole("button", { name: "Templates" }).click();
  await pageButtons(page).nth(0).click();
  await expect(page.locator(".canvas-element.is-table-editing")).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".canvas-element.is-cropping")).toHaveCount(0);
  await expect(page.locator(".canvas-element.is-table-editing")).toHaveCount(0);

  await selectCoverImage(page);
  await clickTransientModeButton(page, "Crop image");
  const versionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/new"),
  );
  await topbar(page)
    .getByRole("button", { name: "Save as version" })
    .click();
  expect((await versionResponse).ok()).toBe(true);
  await expect(page.locator(".canvas-element.is-cropping")).toHaveCount(0);

  await selectCoverImage(page);
  await clickTransientModeButton(page, "Crop image");
  await topbar(page).getByRole("button", { name: /Create report/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create report" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Sample data" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog
    .getByRole("button", { name: "Load & Validate Data" })
    .click();
  await expect(dialog.getByTestId("narrative-workspace")).toBeVisible();
  await dialog.getByRole("button", { name: "Review Report" }).click();
  await dialog.getByRole("button", { name: "Open Report Editor" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".canvas-element.is-cropping")).toHaveCount(0);
  await expect(page.locator(".canvas-element.is-table-editing")).toHaveCount(0);
});

test("direct final PDF API blocks a visible image with no source", async ({
  request,
}) => {
  const response = await request.post("/api/render/pdf", {
    data: {
      template: {
        id: "unsafe-final",
        name: "Unsafe final",
        version: "1",
        pages: [
          {
            id: "page-1",
            name: "Page 1",
            width: 816,
            height: 1056,
            background: "#fff",
            elements: [
              {
                id: "missing-image",
                type: "image",
                name: "Required hero",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                style: {},
                src: "",
              },
            ],
          },
        ],
      },
      data: {},
      title: "Unsafe final",
    },
  });
  expect(response.status()).toBe(422);
  await expect(response.json()).resolves.toMatchObject({
    code: "MISSING_REQUIRED_IMAGE",
  });
});
