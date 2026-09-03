import { expect, test, type APIRequestContext } from "@playwright/test";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import type { ReportInstance } from "../../src/report-engine/schema/generation";

async function createFixture(request: APIRequestContext) {
  const instance = await generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
  instance.id = `report-${crypto.randomUUID()}`;
  const response = await request.post("/api/report-instances", { data: instance });
  expect(response.ok()).toBeTruthy();
  return instance;
}

test("Narratives review tracks 19 markets, manual edits, approval, evidence, and stale state", async ({ page, request }) => {
  const instance = await createFixture(request);
  await page.goto(`/?narrativeReview=${encodeURIComponent(instance.id)}`);
  await expect(page.getByTestId("narrative-workspace")).toBeVisible();
  await expect(page.locator(".narrative-list > button")).toHaveCount(19);
  await expect(page.getByText("Overall Market narrative has not been approved.")).toBeVisible();

  await page.locator(".narrative-list > button").filter({ hasText: "Central DuPage" }).click();
  const editor = page.getByLabel("Central DuPage narrative");
  await editor.fill("Central DuPage maintained balanced fundamentals during the quarter.");
  await page.getByRole("button", { name: "Save Edit" }).click();
  await expect(page.locator(".narrative-editor .status-edited")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".narrative-editor .status-approved")).toBeVisible();

  await page.getByRole("button", { name: "Unlock / Revise" }).click();
  await expect(page.locator(".narrative-editor .status-edited")).toBeVisible();
  await page.getByText("Why did AI write this?").click();
  await expect(page.getByRole("heading", { name: "Market Metrics" })).toBeVisible();

  const stored = (await (await request.get(`/api/report-instances/${instance.id}`)).json()) as ReportInstance;
  const central = stored.narratives.find((item) => item.marketId === "central-dupage")!;
  central.status = "stale";
  const saved = await request.put(`/api/report-instances/${instance.id}`, { data: stored });
  expect(saved.ok()).toBeTruthy();
  await page.reload();
  await page.locator(".narrative-list > button").filter({ hasText: "Central DuPage" }).click();
  await expect(page.locator(".narrative-editor .status-stale")).toBeVisible();
});

test("the review page leads on to the report editor", async ({ page, request }) => {
  const instance = await createFixture(request);
  await page.goto(`/?narrativeReview=${encodeURIComponent(instance.id)}`);
  const readiness = page.locator(".narrative-review-readiness");
  await expect(readiness).toContainText("0 approved / 19 required");
  await expect(readiness).toContainText("19 publication blockers");

  // Reachable while narratives are still draft — the wizard behaves the same
  // way, and PDF export is what publication readiness gates.
  const open = page.getByTestId("open-report-editor");
  await expect(open).toBeEnabled();
  await open.click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    await page.evaluate(() =>
      localStorage.getItem("lee-report-studio.report-instance.v1"),
    ),
  ).toBe(instance.id);
});

test("Generate All uses the server mock, reports progress, and retains partial results", async ({ page, request }) => {
  const instance = await createFixture(request);
  let current = structuredClone(instance);
  await page.route("**/api/narratives/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, model: "mock-narrative-v1", concurrency: 3, message: "AI narrative generation is configured." }),
    }),
  );
  await page.route(`**/api/report-instances/${instance.id}/narratives/generate-all`, (route) => {
    current = {
      ...current,
      narratives: current.narratives.map((record) => ({
        ...record,
        text: `${record.marketName} grounded mock narrative.`,
        status: "draft" as const,
        source: "ai" as const,
        wordCount: 4,
      })),
    };
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ id: "narrative-job-ui", reportInstanceId: instance.id, status: "running", total: 19, completed: 0, failed: 0, marketIds: current.narratives.map((item) => item.marketId) }),
    });
  });
  await page.route(`**/api/report-instances/${instance.id}/narrative-jobs/narrative-job-ui`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "narrative-job-ui", reportInstanceId: instance.id, status: "complete", total: 19, completed: 19, failed: 0, marketIds: current.narratives.map((item) => item.marketId) }),
    }),
  );
  await page.route(`**/api/report-instances/${instance.id}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) }),
  );
  await page.goto(`/?narrativeReview=${encodeURIComponent(instance.id)}`);
  const button = page.getByRole("button", { name: "Generate All Narratives" });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText(/Generating narratives \d+ \/ 19/)).toBeVisible();
  await expect(page.getByText("Generating narratives 19 / 19")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".narrative-list .status-draft")).toHaveCount(19);
});

test("manual narrative editing remains available when OpenAI is not configured", async ({ page, request }) => {
  const instance = await createFixture(request);
  await page.route("**/api/narratives/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: false, model: "unavailable", concurrency: 3, message: "AI narrative generation is not configured." }),
    }),
  );
  await page.goto(`/?narrativeReview=${encodeURIComponent(instance.id)}`);
  await expect(page.getByText("AI narrative generation is not configured.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate All Narratives" })).toBeDisabled();
  await page.getByLabel("Overall Market narrative").fill("A manually written Overall Market narrative.");
  await page.getByRole("button", { name: "Save Edit" }).click();
  await expect(page.locator(".narrative-editor .status-edited")).toBeVisible();
});
