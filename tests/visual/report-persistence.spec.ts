import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import type { ReportInstance } from "../../src/report-engine/schema/generation";
import type {
  ImageElement,
  TableElement,
  TextElement,
} from "../../src/types/report";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "../../src/types/templateLibrary";

const reportKey = "lee-report-studio.report-instance.v1";
const recoveryKey = (id: string) =>
  `lee-report-studio.report-recovery.v1.${id}`;

async function createFixture(request: APIRequestContext) {
  const library = (await (await request.get("/api/templates")).json()) as {
    templates: TemplateVersionSummary[];
  };
  const summary =
    library.templates.find((item) => item.status === "draft") ??
    library.templates[0]!;
  const source = (await (
    await request.get(
      `/api/templates/${summary.id}/versions/${summary.version}`,
    )
  ).json()) as StoredTemplateVersion;
  const instance = await generateReportInstance(source.template, {
    templateId: source.id,
    templateVersion: source.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
  instance.id = `report-${crypto.randomUUID()}`;
  const elements = instance.pages.flatMap((page) => page.elements);
  const text = structuredClone(
    elements.find(
      (element): element is TextElement => element.type === "text",
    )!,
  );
  const image = structuredClone(
    elements.find(
      (element): element is ImageElement => element.type === "image",
    )!,
  );
  const table = structuredClone(
    elements.find(
      (element): element is TableElement => element.type === "table",
    )!,
  );
  Object.assign(text, {
    id: "persistence-text",
    name: "Persistence text",
    text: "Generated narrative",
    binding: { path: "overallMarket.narrative" },
    bindingContext: undefined,
    x: 40,
    y: 40,
  });
  Object.assign(image, {
    id: "persistence-image",
    name: "Persistence image",
    binding: undefined,
    bindingContext: undefined,
    x: 40,
    y: 150,
    width: 180,
    height: 120,
  });
  Object.assign(table, {
    id: "persistence-table",
    name: "Persistence table",
    bindingContext: undefined,
    x: 260,
    y: 150,
    width: 450,
    height: 220,
  });
  instance.pages[0]!.elements = [text, image, table];
  const response = await request.post("/api/report-instances", {
    data: instance,
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ReportInstance;
}

async function openReport(
  browser: Browser,
  reportId: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 900, height: 1120 },
  });
  await context.addInitScript(({ key, id }) => localStorage.setItem(key, id), {
    key: reportKey,
    id: reportId,
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "load" });
  await expect(page.getByTestId("persistence-text")).toBeVisible();
  return { context, page };
}

const waitForSaved = (page: Page) =>
  expect(page.locator(".statusbar")).toContainText("Report saved at", {
    timeout: 15_000,
  });

test("generated report position, style, image, and table edits survive a fresh browser", async ({
  browser,
  request,
}) => {
  const instance = await createFixture(request);
  const first = await openReport(browser, instance.id);
  await first.page.getByTestId("persistence-text").click();
  const position = first.page
    .locator(".inspector-section")
    .filter({ hasText: "Position & Size" });
  const usesInches = await first.page
    .getByRole("button", { name: "in", exact: true })
    .evaluate((element) => element.classList.contains("active"));
  const positionInput = usesInches ? "0.75" : "72";
  await position.getByLabel("Layer name").fill("Persisted text layer");
  await position.getByLabel(/^X/).fill(positionInput);
  await first.page.getByLabel("Text color picker").fill("#1266aa");

  await first.page.getByTestId("persistence-image").click();
  await first.page.getByLabel("Fit").selectOption("contain");

  await first.page.getByTestId("persistence-table").click();
  await first.page.getByLabel("Table row height").fill("31");
  await waitForSaved(first.page);

  const stored = (await (
    await request.get(`/api/report-instances/${instance.id}`)
  ).json()) as ReportInstance;
  const storedElements = stored.pages[0]!.elements;
  expect(
    storedElements.find((element) => element.id === "persistence-text"),
  ).toMatchObject({
    name: "Persisted text layer",
    x: 72,
    style: { typography: { color: "#1266aa" } },
  });
  expect(
    storedElements.find((element) => element.id === "persistence-image"),
  ).toMatchObject({
    fit: "contain",
  });
  expect(
    storedElements.find((element) => element.id === "persistence-table"),
  ).toMatchObject({
    rowHeight: 31,
  });
  await first.context.close();

  const reopened = await openReport(browser, instance.id);
  await expect(reopened.page.getByTestId("persistence-text")).toHaveCSS(
    "color",
    "rgb(18, 102, 170)",
  );
  await reopened.page.getByTestId("persistence-text").click();
  await expect(reopened.page.getByLabel("Layer name")).toHaveValue(
    "Persisted text layer",
  );
  await expect(reopened.page.getByLabel(/^X/)).toHaveValue(positionInput);
  await reopened.page.getByTestId("persistence-image").click();
  await expect(reopened.page.getByLabel("Fit")).toHaveValue("contain");
  await reopened.page.getByTestId("persistence-table").click();
  await expect(reopened.page.getByLabel("Table row height")).toHaveValue("31");
  await reopened.context.close();
});

test("manual overrides stay coherent through undo, redo, save, and reload", async ({
  browser,
  request,
}) => {
  const instance = await createFixture(request);
  const opened = await openReport(browser, instance.id);
  await opened.page.getByTestId("persistence-text").click();
  const editor = opened.page
    .locator(".inspector-section")
    .filter({ hasText: "Typography" })
    .locator("textarea");
  await editor.fill("Reviewed narrative");
  await waitForSaved(opened.page);
  let stored = (await (
    await request.get(`/api/report-instances/${instance.id}`)
  ).json()) as ReportInstance;
  expect(stored.manualOverrides).toHaveLength(1);
  expect(stored.manualOverrides[0]!.overrideValue).toBe("Reviewed narrative");

  await opened.page.keyboard.press("Control+z");
  await waitForSaved(opened.page);
  stored = (await (
    await request.get(`/api/report-instances/${instance.id}`)
  ).json()) as ReportInstance;
  expect(stored.manualOverrides).toEqual([]);

  await opened.page.keyboard.press("Control+Shift+z");
  await waitForSaved(opened.page);
  stored = (await (
    await request.get(`/api/report-instances/${instance.id}`)
  ).json()) as ReportInstance;
  expect(stored.manualOverrides).toHaveLength(1);
  expect(stored.manualOverrides[0]!.overrideValue).toBe("Reviewed narrative");
  await opened.context.close();

  const reopened = await openReport(browser, instance.id);
  await expect(reopened.page.getByTestId("persistence-text")).toContainText(
    "Reviewed narrative",
  );
  await reopened.context.close();
});

test("a stale browser conflicts, keeps recovery, and cannot overwrite the accepted browser", async ({
  browser,
  request,
}) => {
  const instance = await createFixture(request);
  const clientA = await openReport(browser, instance.id);
  const clientB = await openReport(browser, instance.id);

  await clientA.page.getByTestId("persistence-text").click();
  await clientA.page.getByLabel("Layer name").fill("Client A accepted");
  await waitForSaved(clientA.page);

  await clientB.page.getByTestId("persistence-text").click();
  await clientB.page.getByLabel("Layer name").fill("Client B stale");
  await expect(clientB.page.locator(".statusbar")).toContainText(
    "Report conflict",
    { timeout: 15_000 },
  );
  const recovery = await clientB.page.evaluate(
    (key) => localStorage.getItem(key),
    recoveryKey(instance.id),
  );
  expect(recovery).toContain("Client B stale");

  const stored = (await (
    await request.get(`/api/report-instances/${instance.id}`)
  ).json()) as ReportInstance;
  expect(
    stored.pages[0]!.elements.find(
      (element) => element.id === "persistence-text",
    )?.name,
  ).toBe("Client A accepted");
  await clientA.context.close();
  await clientB.context.close();
});

test("autosave exposes failure, retains recovery, retries, and only then reports saved", async ({
  browser,
  request,
}) => {
  const instance = await createFixture(request);
  const opened = await openReport(browser, instance.id);
  let attempts = 0;
  await opened.page.route(
    `**/api/report-instances/${instance.id}/document`,
    async (route) => {
      attempts += 1;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic unavailable" }),
        });
      return route.continue();
    },
  );
  await opened.page.getByTestId("persistence-text").click();
  await opened.page.getByLabel("Layer name").fill("Retry persisted");
  await expect(opened.page.locator(".statusbar")).toContainText(
    "Report error",
    { timeout: 10_000 },
  );
  expect(
    await opened.page.evaluate(
      (key) => localStorage.getItem(key),
      recoveryKey(instance.id),
    ),
  ).toContain("Retry persisted");
  await waitForSaved(opened.page);
  expect(attempts).toBe(2);
  expect(
    await opened.page.evaluate(
      (key) => localStorage.getItem(key),
      recoveryKey(instance.id),
    ),
  ).toBeNull();
  await opened.context.close();
});

test("matching local recovery restores pending edits and resumes authoritative save", async ({
  browser,
  request,
}) => {
  const instance = await createFixture(request);
  const opened = await openReport(browser, instance.id);
  await opened.page.route(
    `**/api/report-instances/${instance.id}/document`,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Remain in local recovery" }),
      }),
  );
  await opened.page.getByTestId("persistence-text").click();
  await opened.page.getByLabel("Layer name").fill("Recovered pending edit");
  await expect(opened.page.locator(".statusbar")).toContainText(
    "Report error",
    { timeout: 10_000 },
  );
  await opened.page.close();

  const restoredPage = await opened.context.newPage();
  await restoredPage.goto("/", { waitUntil: "load" });
  await expect(restoredPage.getByTestId("persistence-text")).toBeVisible();
  await restoredPage.getByTestId("persistence-text").click();
  await expect(restoredPage.getByLabel("Layer name")).toHaveValue(
    "Recovered pending edit",
  );
  await waitForSaved(restoredPage);
  const stored = (await (
    await request.get(`/api/report-instances/${instance.id}`)
  ).json()) as ReportInstance;
  expect(
    stored.pages[0]!.elements.find(
      (element) => element.id === "persistence-text",
    )?.name,
  ).toBe("Recovered pending edit");
  await opened.context.close();
});

test("report API rejects malformed full documents and malformed document patches", async ({
  request,
}) => {
  const create = await request.post("/api/report-instances", {
    data: { id: `report-${crypto.randomUUID()}`, narratives: [] },
  });
  expect(create.status()).toBe(400);
  expect(await create.json()).toMatchObject({
    code: "INVALID_REPORT_INSTANCE",
  });

  const instance = await createFixture(request);
  const patch = await request.patch(
    `/api/report-instances/${instance.id}/document`,
    { data: { baseRevision: instance.revision, pages: "invalid" } },
  );
  expect(patch.status()).toBe(400);
  expect(await patch.json()).toMatchObject({
    code: "INVALID_REPORT_INSTANCE",
  });
});
