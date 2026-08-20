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

/**
 * The rotation handle sits inside a scaled/centered scroll container whose
 * viewport clipping makes real-cursor `page.mouse` interaction unreliable
 * in this suite (the handle's true geometry is correct, but Chromium's own
 * hit-testing at that point can land on an ancestor). The app's drag
 * handlers only consume `clientX`/`clientY` off native PointerEvents
 * (`onPointerDown` on the handle, `window.addEventListener("pointermove"/
 * "pointerup", ...)` for the rest of the drag), so dispatching those events
 * directly reproduces a real drag deterministically.
 */
async function dragRotationHandle(
  page: Page,
  target: { x: number; y: number },
  options: { altKey?: boolean; shiftKey?: boolean } = {},
) {
  await page.evaluate(
    ({ target, options }) => {
      const handle = document.querySelector(".rotation-handle");
      if (!handle) throw new Error("Rotation handle not found.");
      const rect = handle.getBoundingClientRect();
      const startX = rect.x + rect.width / 2;
      const startY = rect.y + rect.height / 2;
      const base = {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        altKey: options.altKey ?? false,
        shiftKey: options.shiftKey ?? false,
      };
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...base,
          clientX: startX,
          clientY: startY,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          ...base,
          clientX: target.x,
          clientY: target.y,
        }),
      );
    },
    { target, options },
  );
}

async function releaseRotationHandle(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  });
}

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

test("drag rotation handle snaps to 90 and syncs the inspector field", async ({
  page,
}) => {
  await selectTopAvailabilities(page);

  const selected = page.locator(".canvas-element.is-selected");
  const box = await selected.boundingBox();
  if (!box) throw new Error("Selected element has no bounding box.");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // A point directly right of center (dy = 0) resolves to a 90-degree drag angle.
  await dragRotationHandle(page, { x: centerX + 220, y: centerY + 2 });
  await expect(page.locator(".rotation-tooltip")).toContainText("90");
  await releaseRotationHandle(page);

  await expect(async () => {
    expect(await readRotation(selected)).toBeCloseTo(90, 0);
  }).toPass();
  await expect(page.getByLabel(/^Rotation/)).toHaveValue("90");
});

test("drag rotation handle snaps to 45 and free rotation bypasses snapping with Alt", async ({
  page,
}) => {
  await selectTopAvailabilities(page);

  const selected = page.locator(".canvas-element.is-selected");
  const box = await selected.boundingBox();
  if (!box) throw new Error("Selected element has no bounding box.");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // Up-and-right at 45 degrees from center resolves to a 45-degree drag angle.
  await dragRotationHandle(page, { x: centerX + 200, y: centerY - 200 });
  await releaseRotationHandle(page);
  await expect(async () => {
    expect(await readRotation(selected)).toBeCloseTo(45, 0);
  }).toPass();
  await expect(page.getByLabel(/^Rotation/)).toHaveValue("45");

  // Free rotation: an angle just inside the 90-degree snap threshold would
  // normally snap to 90; holding Alt during the drag must bypass that.
  await dragRotationHandle(
    page,
    { x: centerX + 210, y: centerY - 15 },
    { altKey: true },
  );
  await releaseRotationHandle(page);
  const freeAngle = await readRotation(selected);
  expect(freeAngle).not.toBeCloseTo(45, 0);
  expect(freeAngle).not.toBeCloseTo(90, 0);
});
