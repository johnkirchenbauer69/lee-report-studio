import { expect, test } from "@playwright/test";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import { sampleTemplate } from "../../src/data/sampleTemplate";

for (const [width, height] of [
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
]) {
  test(`official app identity and usable report navigation at ${width} x ${height}`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    const instance = await generateReportInstance(sampleTemplate, {
      templateId: sampleTemplate.id,
      templateVersion: sampleTemplate.version,
      market: "Chicago",
      period: "2026 Q2",
      calculationScope: { type: "all-submarkets" },
      pageSelection: { submarketIds: [] },
      source: { provider: "sample" },
    });
    const created = await request.post("/api/report-instances", {
      data: instance,
    });
    expect(created.ok()).toBeTruthy();
    const saved = await created.json();
    const published = await request.post(
      `/api/report-instances/${saved.id}/publish`,
      { data: { baseRevision: saved.revision } },
    );
    expect(published.ok()).toBeTruthy();
    await page.goto("/");
    const logo = page.locator(".dashboard-brand img");
    await expect(logo).toHaveAttribute("src", "/brand/lee-full-color.png");
    await expect(page.locator(".application-brand img")).toHaveAttribute(
      "src",
      "/brand/lee-icon.png",
    );
    await expect(
      page.getByRole("button", { name: "Create New Report", exact: true }),
    ).toHaveCSS("background-color", "rgb(152, 0, 46)");
    expect(
      await logo.evaluate((img: HTMLImageElement) =>
        Math.abs(
          img.clientWidth / img.clientHeight -
            img.naturalWidth / img.naturalHeight,
        ),
      ),
    ).toBeLessThan(0.1);
    expect(
      await page.evaluate(() =>
        document.querySelector('link[rel="icon"]')?.getAttribute("href"),
      ),
    ).toBe("/brand/lee-app.ico");
    await page.screenshot({ path: testInfo.outputPath("home.png") });
    await page.getByRole("button", { name: "Create New Report", exact: true }).click();
    const generator = page.getByRole("dialog", { name: "Create report", exact: true });
    await expect(generator.getByRole("button", { name: "Continue", exact: true })).toHaveCSS("background-color", "rgb(152, 0, 46)");
    await generator.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await page
      .getByRole("button", { name: "Published reports", exact: true })
      .click();
    const card = page.locator(".library-card").filter({ hasText: saved.id });
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Open report", exact: true }),
    ).toBeEnabled();
    await card
      .getByRole("button", { name: "Open report", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Published report", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".document-identity")).toContainText("published");
    await page.getByRole("button", { name: "Focus Mode", exact: true }).click();
    await expect(page.locator(".left-panel")).toBeHidden();
    await page
      .getByRole("button", { name: "Exit Focus Mode", exact: true })
      .click();
    await expect(page.locator(".left-panel")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("editor.png") });
  });
}

test("removes only recovery entries for conclusively deleted reports", async ({
  page,
}) => {
  await page.route("**/api/report-instances/deleted", (route) =>
    route.fulfill({ json: { ids: ["report-deleted-fixture"] } }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "lee-report-studio.report-recovery.v1.report-deleted-fixture",
      "{}",
    );
    localStorage.setItem(
      "lee-report-studio.report-recovery.v1.report-unrelated-fixture",
      "preserve",
    );
    localStorage.setItem("unrelated-preference", "preserve");
  });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem(
          "lee-report-studio.report-recovery.v1.report-deleted-fixture",
        ),
      ),
    )
    .toBeNull();
  expect(
    await page.evaluate(() =>
      localStorage.getItem(
        "lee-report-studio.report-recovery.v1.report-unrelated-fixture",
      ),
    ),
  ).toBe("preserve");
  expect(
    await page.evaluate(() => localStorage.getItem("unrelated-preference")),
  ).toBe("preserve");
});
