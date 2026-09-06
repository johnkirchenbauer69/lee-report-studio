import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import type { ReportTemplate } from "../../src/types/report";

const topbar = (page: Page) => page.locator(".topbar");
const pageButtons = (page: Page) => page.locator(".page-list > button");
const activePageIndex = (page: Page) =>
  pageButtons(page).evaluateAll((buttons) =>
    buttons.findIndex((button) => button.classList.contains("active")),
  );

async function openTemplates(page: Page) {
  await page.getByRole("button", { name: /Templates/ }).click();
  await expect(pageButtons(page).first()).toBeVisible();
}

async function ensureDraft(page: Page) {
  const save = topbar(page).getByRole("button", { name: "Save", exact: true });
  await expect(
    topbar(page).getByRole("button", { name: "Save as version" }),
  ).toBeEnabled();
  if (await save.isDisabled()) {
    await topbar(page).getByRole("button", { name: "Save as version" }).click();
    await expect(save).toBeEnabled();
  }
}

test("save, save-as and publish preserve the active page while open starts at page zero", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });
  await openTemplates(page);
  await ensureDraft(page);

  const targetIndex = Math.min(16, (await pageButtons(page).count()) - 1);
  expect(targetIndex).toBeGreaterThan(0);
  await pageButtons(page).nth(targetIndex).click();
  expect(await activePageIndex(page)).toBe(targetIndex);

  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      /\/api\/templates\/[^/]+\/versions\/[^/]+$/.test(response.url()),
  );
  await topbar(page).getByRole("button", { name: "Save", exact: true }).click();
  expect((await saveResponse).ok()).toBe(true);
  await expect.poll(() => activePageIndex(page)).toBe(targetIndex);

  const versionLabel = page.locator(".brand > div:last-child > span");
  const versionBeforeSaveAs = await versionLabel.innerText();
  const versionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/new"),
  );
  await topbar(page).getByRole("button", { name: "Save as version" }).click();
  expect((await versionResponse).ok()).toBe(true);
  await expect(versionLabel).not.toHaveText(versionBeforeSaveAs);
  await expect.poll(() => activePageIndex(page)).toBe(targetIndex);

  const publishResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/publish"),
  );
  await topbar(page)
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  expect((await publishResponse).ok()).toBe(true);
  await expect(versionLabel).toContainText("published");
  await expect.poll(() => activePageIndex(page)).toBe(targetIndex);
  await expect(
    topbar(page).getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  const published = page
    .locator(".template-version-list > section")
    .filter({ hasText: "published" })
    .first();
  await published.getByRole("button", { name: "Open", exact: true }).click();
  await expect.poll(() => activePageIndex(page)).toBe(0);

  const restoreDraftResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/new"),
  );
  await topbar(page).getByRole("button", { name: "Save as version" }).click();
  expect((await restoreDraftResponse).ok()).toBe(true);
  await expect(
    topbar(page).getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await pageButtons(page).nth(targetIndex).click();
  const draft = page
    .locator(".template-version-list > section")
    .filter({ hasText: "draft" })
    .first();
  await draft.getByRole("button", { name: "Open Draft", exact: true }).click();
  await expect.poll(() => activePageIndex(page)).toBe(0);
});

test("image shadow and independent corners persist, with a live radius handle", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });
  await ensureDraft(page);
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /Chicago Skyline.*image/i })
    .click();
  const image = page.locator(".canvas-element.is-selected");

  await page.getByLabel("Drop Shadow").check();
  await expect(image).toHaveCSS("box-shadow", /rgba\(0, 0, 0, 0\.25\)/);
  await page.getByLabel("Link corner radii").uncheck();
  await page.getByLabel("Top left radius").fill("24");
  await expect(image).toHaveCSS("border-top-left-radius", "24px");
  await expect(image).toHaveCSS("border-top-right-radius", "0px");
  await expect(image.locator(".element-content-clip")).toHaveCSS(
    "border-top-left-radius",
    "24px",
  );

  await openTemplates(page);
  await topbar(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".canvas-element.is-selected")).toHaveCount(1);
  const activeDraft = page
    .locator(".template-version-list > section.active")
    .filter({ hasText: "draft" });
  await activeDraft
    .getByRole("button", { name: "Open Draft", exact: true })
    .click();
  await expect(page.locator(".canvas-element.is-selected")).toHaveCount(0);
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /Chicago Skyline.*image/i })
    .click();
  await expect(page.locator(".canvas-element.is-selected")).toHaveCSS(
    "border-top-left-radius",
    "24px",
  );

  await page.locator(".shape-grid > button").first().click();
  await page.getByLabel("Link corner radii").uncheck();
  await page.getByLabel("Top left radius").fill("8");
  const handle = page.getByRole("button", { name: "topLeft corner radius" });
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("Corner radius handle is not visible.");
  await page.mouse.move(handleBox.x + 5, handleBox.y + 5);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 29, handleBox.y + 5, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Top left radius").inputValue()),
    )
    .toBeGreaterThan(8);
  await expect(page.getByLabel("Top right radius")).toHaveValue("0");

  await page.getByLabel("Link corner radii").check();
  const linkedHandle = page.getByRole("button", {
    name: "topLeft corner radius",
  });
  const linkedBox = await linkedHandle.boundingBox();
  if (!linkedBox)
    throw new Error("Linked corner radius handle is not visible.");
  await page.mouse.move(linkedBox.x + 5, linkedBox.y + 5);
  await page.mouse.down();
  await page.mouse.move(linkedBox.x + 15, linkedBox.y + 5, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel("Link corner radii").uncheck();
  const values = await Promise.all(
    [
      "Top left radius",
      "Top right radius",
      "Bottom right radius",
      "Bottom left radius",
    ].map((label) => page.getByLabel(label).inputValue()),
  );
  expect(new Set(values).size).toBe(1);
});

test("bevel, shift multi-select, rigid drag, union and undo work together", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });
  await ensureDraft(page);
  await page.getByRole("button", { name: "Elements" }).click();
  await page.locator(".shape-grid > button").first().click();
  const first = page.locator(".canvas-element.is-selected");
  const firstId = await first.getAttribute("data-testid");
  if (!firstId) throw new Error("First shape has no stable ID.");
  await page.getByLabel("Bevel").check();
  await expect(first).toHaveCSS("box-shadow", /inset/);

  await page.locator(".shape-grid > button").first().click();
  await page.getByLabel(/^X/).fill("400");
  const second = page.locator(".canvas-element.is-selected");
  const secondId = await second.getAttribute("data-testid");
  if (!secondId) throw new Error("Second shape has no stable ID.");

  const firstBox = await page.getByTestId(firstId).boundingBox();
  const secondBox = await page.getByTestId(secondId).boundingBox();
  if (!firstBox || !secondBox) throw new Error("Shapes are not visible.");
  await page.mouse.click(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2,
  );
  await page.keyboard.down("Shift");
  await page.mouse.click(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
  );
  await page.keyboard.up("Shift");
  await expect(page.locator(".canvas-element.is-selected")).toHaveCount(2);
  await expect(page.locator(".inspector-header")).toContainText("2 elements");

  await page.keyboard.down("Shift");
  await page.mouse.click(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
  );
  await page.keyboard.up("Shift");
  await expect(page.locator(".canvas-element.is-selected")).toHaveCount(1);
  await page.keyboard.down("Shift");
  await page.mouse.click(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
  );
  await page.keyboard.up("Shift");

  const before = await Promise.all(
    [firstId, secondId].map((id) =>
      page.getByTestId(id).evaluate((node) => ({
        left: Number.parseFloat((node as HTMLElement).style.left),
        top: Number.parseFloat((node as HTMLElement).style.top),
      })),
    ),
  );
  const dragBox = await page.getByTestId(firstId).boundingBox();
  if (!dragBox) throw new Error("Selected shape cannot be dragged.");
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragBox.x + dragBox.width / 2 + 30,
    dragBox.y + dragBox.height / 2 + 20,
    { steps: 8 },
  );
  await page.mouse.up();
  const after = await Promise.all(
    [firstId, secondId].map((id) =>
      page.getByTestId(id).evaluate((node) => ({
        left: Number.parseFloat((node as HTMLElement).style.left),
        top: Number.parseFloat((node as HTMLElement).style.top),
      })),
    ),
  );
  expect(after[0].left - before[0].left).toBe(after[1].left - before[1].left);
  expect(after[0].top - before[0].top).toBe(after[1].top - before[1].top);

  const blankStage = page.locator("main.stage");
  await page.keyboard.down("Shift");
  await blankStage.click({
    position: { x: 5, y: 5 },
    modifiers: ["Shift"],
    force: true,
  });
  await page.keyboard.up("Shift");
  await expect(page.locator(".canvas-element.is-selected")).toHaveCount(2);
  await blankStage.click({ position: { x: 5, y: 5 }, force: true });
  await expect(page.locator(".canvas-element.is-selected")).toHaveCount(0);

  const shapeLayers = page
    .locator(".layer-list button")
    .filter({ hasText: "Rectangle" });
  await shapeLayers.nth(0).click();
  await page.getByLabel(/^X/).fill("130");
  await shapeLayers.nth(1).click({ modifiers: ["Shift"] });
  await expect(
    page.getByRole("button", { name: "Union shapes" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Union shapes" }).click();
  await expect(
    page.locator(".canvas-element.is-selected .shape-path-svg"),
  ).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId(firstId)).toBeVisible();
  await expect(page.getByTestId(secondId)).toBeVisible();
});

test("table edit mode applies a text shadow only to the targeted header cell", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });
  await ensureDraft(page);
  await openTemplates(page);
  await page.getByRole("button", { name: "Overall Market Table" }).click();
  const table = page.getByTestId("submarket-matrix");
  await expect(table).toBeVisible();
  const tableBox = await table.boundingBox();
  if (!tableBox) throw new Error("Table is not visible.");
  await page.mouse.dblclick(
    tableBox.x + tableBox.width / 2,
    tableBox.y + tableBox.height / 2,
  );
  const target = table.locator("th").nth(2);
  await target.click();
  await page.getByLabel("Table selection text shadow").check();
  await expect(target).toHaveCSS("text-shadow", /rgba\(0, 0, 0, 0\.25\)/);
  await expect(table.locator("th").nth(1)).toHaveCSS("text-shadow", "none");
});

test("Chromium PDF renders bevel, image shadow, per-corner clipping, table shadow, and union path", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/", { waitUntil: "load" });
  await ensureDraft(page);
  const shadow = {
    enabled: true,
    color: "#000000",
    offsetX: 6,
    offsetY: 7,
    blur: 9,
    opacity: 0.4,
  } as const;
  const bevel = {
    enabled: true,
    size: 5,
    direction: "raised" as const,
    highlightColor: "#ffffff",
    highlightOpacity: 0.65,
    shadowColor: "#001827",
    shadowOpacity: 0.5,
  };
  const template: ReportTemplate = {
    id: "editor-styling-pdf",
    name: "Editor Styling PDF Acceptance",
    version: "1.0.0",
    pages: [
      {
        id: "page-1",
        name: "Effects",
        width: 816,
        height: 1056,
        background: "#ffffff",
        elements: [
          {
            id: "beveled-shape",
            type: "shape",
            shape: "rounded-rectangle",
            name: "Beveled shape",
            x: 70,
            y: 80,
            width: 280,
            height: 160,
            style: {
              fill: { type: "solid", color: "#c4123f" },
              bevel,
              cornerRadii: {
                topLeft: 36,
                topRight: 12,
                bottomRight: 28,
                bottomLeft: 4,
                linked: false,
              },
            },
          },
          {
            id: "shadow-image",
            type: "image",
            name: "Shadow image",
            x: 440,
            y: 80,
            width: 280,
            height: 160,
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect width='280' height='160' fill='%23003c50'/%3E%3Ccircle cx='140' cy='80' r='48' fill='%23ffffff'/%3E%3C/svg%3E",
            fit: "cover",
            style: {
              shadow,
              cornerRadii: {
                topLeft: 42,
                topRight: 8,
                bottomRight: 30,
                bottomLeft: 0,
                linked: false,
              },
            },
          },
          {
            id: "shadow-table",
            type: "table",
            name: "Shadow table",
            x: 70,
            y: 320,
            width: 650,
            height: 180,
            sourcePath: "rows",
            columns: [
              {
                key: "label",
                label: "LABEL",
                path: "label",
                headerStyle: { shadow },
              },
              { key: "value", label: "VALUE", path: "value" },
            ],
            cellStyles: { "body:0:1": { shadow } },
            style: { fontFamily: "Arial", fontSize: 18 },
          },
          {
            id: "union-path",
            type: "shape",
            shape: "path",
            name: "Union path",
            x: 120,
            y: 600,
            width: 560,
            height: 280,
            style: {
              fill: { type: "solid", color: "#f0a23a" },
              stroke: {
                enabled: true,
                color: "#003c50",
                width: 5,
                opacity: 1,
                style: "solid",
              },
              shadow,
            },
            pathGeometry: {
              rings: [
                [
                  { x: 0, y: 0 },
                  { x: 0.65, y: 0 },
                  { x: 0.65, y: 0.25 },
                  { x: 1, y: 0.25 },
                  { x: 1, y: 1 },
                  { x: 0.35, y: 1 },
                  { x: 0.35, y: 0.75 },
                  { x: 0, y: 0.75 },
                ],
              ],
            },
          },
        ],
      },
    ],
  };
  const response = await page.request.post("/api/render/pdf", {
    data: {
      template,
      data: { rows: [{ label: "Targeted", value: "Shadow" }] },
      title: template.name,
    },
  });
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const bytes = await response.body();
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  expect(bytes.byteLength).toBeGreaterThan(5_000);
  const output = testInfo.outputPath("editor-styling-chromium.pdf");
  await writeFile(output, bytes);
  await testInfo.attach("editor-styling-chromium.pdf", {
    path: output,
    contentType: "application/pdf",
  });
});
