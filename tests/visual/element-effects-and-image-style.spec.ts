import { expect, test, type Locator, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const templateId = "industrial-market-report";

async function openTemplatePage(page: Page, version: string, name: string) {
  await page.locator(".rail").getByTitle("Templates").click();
  const card = page
    .locator(".template-version-list section")
    .filter({ hasText: `v${version} · draft` });
  const opened = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().endsWith(`/versions/${version}`),
  );
  await card.getByRole("button", { name: "Open Draft" }).click();
  expect((await opened).ok()).toBe(true);
  await page
    .locator(".page-list")
    .getByRole("button", { name: new RegExp(`${name}$`) })
    .click();
  await expect(page.locator(".stage-topline span").first()).toHaveText(name);
}

const section = (page: Page, title: string): Locator =>
  page.locator(".inspector-section").filter({
    has: page.locator("summary", { hasText: title }),
  });

test("text and shape shadows plus image stroke and clipping persist through save, replacement, reload, and PDF", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const sourceResponse = await page.request.get(
    `/api/templates/${templateId}/versions/1.8.0`,
  );
  test.skip(!sourceResponse.ok(), "The governed v1.8.0 draft is unavailable.");
  const source = (await sourceResponse.json()) as {
    template: {
      pages: Array<{
        id: string;
        name: string;
        elements: Array<{
          id: string;
          type: string;
          name: string;
          x: number;
          y: number;
          width: number;
          height: number;
          rotation?: number;
          src?: string;
          style: Record<string, unknown>;
        }>;
      }>;
    };
  };
  const fixturePage = source.template.pages.find(
    (candidate) =>
      candidate.elements.some((element) => element.type === "text") &&
      candidate.elements.some((element) => element.type === "shape") &&
      candidate.elements.some((element) => element.type === "image"),
  );
  expect(
    fixturePage,
    "v1.8.0 needs a page with text, shape, and image elements",
  ).toBeTruthy();
  const text = fixturePage!.elements.find(
    (element) => element.type === "text",
  )!;
  const shape = fixturePage!.elements.find(
    (element) => element.type === "shape",
  )!;
  const image = fixturePage!.elements.find(
    (element) => element.type === "image",
  )!;

  const createResponse = await page.request.post(
    `/api/templates/${templateId}/versions/1.8.0/new`,
    { data: { template: source.template } },
  );
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { version: string };
  const createdUrl = `/api/templates/${templateId}/versions/${created.version}`;

  try {
    await page.goto("/", { waitUntil: "load" });
    await openTemplatePage(page, created.version, fixturePage!.name);

    const textNode = page.getByTestId(text.id);
    await expect(textNode).toHaveCount(1);
    await textNode.evaluate((node) => (node as HTMLElement).click());
    await expect(textNode).toHaveClass(/is-selected/);
    const textShadow = section(page, "Drop Shadow");
    await expect(textShadow).toBeVisible();
    await expect(textNode).toHaveCSS("text-shadow", "none");
    await textShadow.getByLabel("Drop Shadow").check();
    await textShadow
      .getByRole("textbox", { name: "Shadow color" })
      .fill("#224466");
    await textShadow.getByLabel("Shadow X Offset").fill("3");
    await textShadow.getByLabel("Shadow Y Offset").fill("4");
    await textShadow.getByLabel("Shadow Blur").fill("6");
    await textShadow.getByLabel("Shadow Opacity").fill("35");
    await expect(textNode).toHaveCSS(
      "text-shadow",
      "rgba(34, 68, 102, 0.35) 3px 4px 6px",
    );

    const shapeNode = page.getByTestId(shape.id);
    await shapeNode.evaluate((node) => (node as HTMLElement).click());
    await expect(shapeNode).toHaveClass(/is-selected/);
    const shapeShadow = section(page, "Drop Shadow");
    await expect(shapeShadow).toBeVisible();
    await shapeShadow.getByLabel("Drop Shadow").check();
    await shapeShadow
      .getByRole("textbox", { name: "Shadow color" })
      .fill("#102030");
    await shapeShadow.getByLabel("Shadow X Offset").fill("-2");
    await shapeShadow.getByLabel("Shadow Y Offset").fill("5");
    await shapeShadow.getByLabel("Shadow Blur").fill("8");
    await shapeShadow.getByLabel("Shadow Opacity").fill("40");
    await expect(shapeNode).toHaveCSS(
      "box-shadow",
      "rgba(16, 32, 48, 0.4) -2px 5px 8px 0px",
    );

    const imageNode = page.getByTestId(image.id);
    await imageNode.evaluate((node) => (node as HTMLElement).click());
    await expect(imageNode).toHaveClass(/is-selected/);
    await expect(section(page, "Drop Shadow")).toHaveCount(0);
    const imageStyle = section(page, "Stroke & Corners");
    await expect(imageStyle).toBeVisible();
    await imageStyle.getByLabel("Stroke").check();
    await imageStyle
      .getByRole("textbox", { name: "Stroke color" })
      .fill("#c4123f");
    await imageStyle.getByLabel("Stroke width").fill("4");
    await imageStyle.getByLabel("Corner radius value").fill("18");
    await expect(imageNode).toHaveCSS("border-width", "4px");
    await expect(imageNode).toHaveCSS("border-radius", "18px");
    await expect(imageNode.locator('[data-image-clip="true"]')).toHaveCSS(
      "overflow",
      "hidden",
    );
    await expect(imageNode.locator('[data-image-clip="true"]')).toHaveCSS(
      "border-radius",
      "18px",
    );

    const geometryBefore = await imageNode.evaluate((node) => {
      const element = node as HTMLElement;
      return {
        left: element.style.left,
        top: element.style.top,
        width: element.style.width,
        height: element.style.height,
        transform: element.style.transform,
        src: element.querySelector("img")?.getAttribute("src"),
      };
    });
    await page.getByRole("button", { name: "Replace Image" }).click();
    const replacementOptions = page.locator(".asset-grid button");
    const replacementIndex = await replacementOptions.evaluateAll(
      (buttons, currentSource) =>
        buttons.findIndex(
          (button) =>
            button.querySelector("img")?.getAttribute("src") !== currentSource,
        ),
      geometryBefore.src,
    );
    expect(replacementIndex).toBeGreaterThanOrEqual(0);
    await replacementOptions.nth(replacementIndex).click();
    await expect(imageNode).toHaveCSS("border-width", "4px");
    await expect(imageNode).toHaveCSS("border-radius", "18px");
    expect(
      await imageNode.evaluate((node) => {
        const element = node as HTMLElement;
        return {
          left: element.style.left,
          top: element.style.top,
          width: element.style.width,
          height: element.style.height,
          transform: element.style.transform,
          src: element.querySelector("img")?.getAttribute("src"),
        };
      }),
    ).toMatchObject({
      left: geometryBefore.left,
      top: geometryBefore.top,
      width: geometryBefore.width,
      height: geometryBefore.height,
      transform: geometryBefore.transform,
    });
    expect(await imageNode.locator("img").getAttribute("src")).not.toBe(
      geometryBefore.src,
    );

    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(createdUrl),
    );
    await page
      .locator(".topbar")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    expect((await saveResponse).ok()).toBe(true);

    const stored = (await (await page.request.get(createdUrl)).json()) as {
      template: typeof source.template;
    };
    const storedPage = stored.template.pages.find(
      (candidate) => candidate.id === fixturePage!.id,
    )!;
    expect(
      storedPage.elements.find((element) => element.id === text.id)?.style,
    ).toMatchObject({
      shadow: {
        enabled: true,
        color: "#224466",
        offsetX: 3,
        offsetY: 4,
        blur: 6,
        opacity: 0.35,
      },
    });
    expect(
      storedPage.elements.find((element) => element.id === shape.id)?.style,
    ).toMatchObject({
      shadow: {
        enabled: true,
        color: "#102030",
        offsetX: -2,
        offsetY: 5,
        blur: 8,
        opacity: 0.4,
      },
    });
    expect(
      storedPage.elements.find((element) => element.id === image.id)?.style,
    ).toMatchObject({
      borderRadius: 18,
      stroke: { enabled: true, color: "#c4123f", width: 4 },
    });

    const pdfResponse = await page.request.post("/api/render/pdf", {
      data: {
        template: stored.template,
        data: {},
        title: "Element effects persistence",
      },
      timeout: 90_000,
    });
    expect(pdfResponse.ok()).toBe(true);
    expect(
      (await PDFDocument.load(await pdfResponse.body())).getPageCount(),
    ).toBe(stored.template.pages.length);

    await page.reload({ waitUntil: "load" });
    await openTemplatePage(page, created.version, fixturePage!.name);
    await expect(page.getByTestId(text.id)).toHaveCSS(
      "text-shadow",
      "rgba(34, 68, 102, 0.35) 3px 4px 6px",
    );
    await expect(page.getByTestId(shape.id)).toHaveCSS(
      "box-shadow",
      "rgba(16, 32, 48, 0.4) -2px 5px 8px 0px",
    );
    await expect(page.getByTestId(image.id)).toHaveCSS("border-radius", "18px");
    await expect(page.getByTestId(image.id)).toHaveCSS("border-width", "4px");
  } finally {
    await page.request.delete(createdUrl).catch(() => undefined);
  }
});
