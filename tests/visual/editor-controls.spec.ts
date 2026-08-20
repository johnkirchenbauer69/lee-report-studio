import { expect, test, type Page } from "@playwright/test";

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

const readRotation = (locator: import("@playwright/test").Locator) =>
  locator.evaluate((node) => {
    const matrix = new DOMMatrix(getComputedStyle(node).transform);
    return ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
  });

async function selectTopAvailabilities(page: Page) {
  await page.goto("/", { waitUntil: "load" });
  await page.getByRole("button", { name: /Templates/ }).click();
  await page.getByRole("button", { name: "Market Highlights" }).click();
  await page.getByRole("combobox", { name: "Zoom" }).selectOption("100%");
  await page.getByRole("button", { name: "Elements" }).click();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /TOP AVAILABILITIES.*text/i })
    .click();
}

/**
 * Real mouse-driven drag on the rotation handle -- this is deliberately a
 * genuine `page.mouse` gesture, not synthetic PointerEvent dispatch,
 * because a real user's cursor is exactly what regressed when the
 * element's content wrapper clipped the handle via `overflow: hidden`
 * (the handle was geometrically present but not actually hit-testable or
 * visible). A synthetic-dispatch helper would not have caught that.
 */
async function dragRotationHandleWithMouse(
  page: Page,
  target: { x: number; y: number },
  options: { altKey?: boolean } = {},
) {
  const handle = page.locator(".rotation-handle");
  await handle.hover();
  await page.mouse.down();
  if (options.altKey) await page.keyboard.down("Alt");
  await page.mouse.move(target.x, target.y, { steps: 15 });
}

async function releaseMouse(page: Page, options: { altKey?: boolean } = {}) {
  await page.mouse.up();
  if (options.altKey) await page.keyboard.up("Alt");
}

test("drag rotation handle snaps to 90 and syncs the inspector field", async ({
  page,
}) => {
  await selectTopAvailabilities(page);

  const selected = page.locator(".canvas-element.is-selected");
  const testId = await selected.getAttribute("data-testid");
  const stable = page.locator(`[data-testid="${testId}"]`);
  const box = await selected.boundingBox();
  if (!box) throw new Error("Selected element has no bounding box.");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // A point directly right of center (dy = 0) resolves to a 90-degree drag angle.
  await dragRotationHandleWithMouse(page, { x: centerX + 220, y: centerY + 2 });
  await expect(page.locator(".rotation-tooltip")).toContainText("90");
  await expect(async () => {
    expect(await readRotation(stable)).toBeCloseTo(90, 0);
  }).toPass();
  await releaseMouse(page);

  // The drag can end past the element's edge, over empty canvas, which
  // clears selection ("click outside deselects") -- reselect to confirm
  // the rotation persisted and is reflected in the inspector.
  expect(await readRotation(stable)).toBeCloseTo(90, 0);
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /TOP AVAILABILITIES.*text/i })
    .click();
  await expect(page.getByLabel(/^Rotation/)).toHaveValue("90");
});

test("drag rotation handle snaps to 45 and free rotation bypasses snapping with Alt", async ({
  page,
}) => {
  await selectTopAvailabilities(page);

  const selected = page.locator(".canvas-element.is-selected");
  const testId = await selected.getAttribute("data-testid");
  const stable = page.locator(`[data-testid="${testId}"]`);
  const box = await selected.boundingBox();
  if (!box) throw new Error("Selected element has no bounding box.");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // Up-and-right at 45 degrees from center resolves to a 45-degree drag angle.
  await dragRotationHandleWithMouse(page, { x: centerX + 200, y: centerY - 200 });
  await releaseMouse(page);
  await expect(async () => {
    expect(await readRotation(stable)).toBeCloseTo(45, 0);
  }).toPass();
  await page
    .locator(".layer-list")
    .getByRole("button", { name: /TOP AVAILABILITIES.*text/i })
    .click();
  await expect(page.getByLabel(/^Rotation/)).toHaveValue("45");

  // Free rotation: an angle just inside the 90-degree snap threshold would
  // normally snap to 90; holding Alt during the drag must bypass that.
  await dragRotationHandleWithMouse(
    page,
    { x: centerX + 210, y: centerY - 15 },
    { altKey: true },
  );
  await releaseMouse(page, { altKey: true });
  const freeAngle = await readRotation(stable);
  expect(freeAngle).not.toBeCloseTo(45, 0);
  expect(freeAngle).not.toBeCloseTo(90, 0);
});
