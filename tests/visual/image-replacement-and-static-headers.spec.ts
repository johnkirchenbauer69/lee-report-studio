import { expect, test, type Page } from "@playwright/test";
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

async function selectLayer(page: Page, name: RegExp) {
  await page.locator(".rail").getByTitle("Elements").click();
  await page.locator(".layer-list").getByRole("button", { name }).click();
}

interface StaticHeaderSource {
  template: {
    pages: Array<{
      id: string;
      elements: Array<{
        id: string;
        type: string;
        y: number;
      }>;
    }>;
  };
}

// The native header logo's element id is whatever the editor assigned it
// (e.g. a Replace Image-generated "image-<hex>"), not a fixed
// "${pageId}-logo" — it must be looked up from the source template rather
// than assumed.
function logoId(source: StaticHeaderSource, pageId: string) {
  const id = source.template.pages
    .find((candidate) => candidate.id === pageId)
    ?.elements.find(
      (element) =>
        element.type === "image" &&
        element.y < 110 &&
        !element.id.endsWith("-artwork"),
    )?.id;
  if (!id) throw new Error(`Native header logo is missing from ${pageId}.`);
  return id;
}

test("static headers are editable and Replace Image preserves the selected image identity", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sourceResponse = await page.request.get(
    `/api/templates/${templateId}/versions/1.8.0`,
  );
  test.skip(!sourceResponse.ok(), "The governed v1.8.0 draft is unavailable.");
  const source = (await sourceResponse.json()) as StaticHeaderSource;
  const methodologyLogoId = logoId(source, "data-methodology");
  const definitionsLogoId = logoId(source, "definitions");
  const contactsLogoId = logoId(source, "contacts");
  const createResponse = await page.request.post(
    `/api/templates/${templateId}/versions/1.8.0/new`,
    { data: { template: source.template } },
  );
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { version: string };
  const createdUrl = `/api/templates/${templateId}/versions/${created.version}`;

  try {
    await page.goto("/", { waitUntil: "networkidle" });
    await openTemplatePage(page, created.version, "Data Methodology");

    await selectLayer(page, /DATA METHODOLOGY.*text/i);
    await expect(
      page.getByRole("button", { name: "Replace Image" }),
    ).toHaveCount(0);
    await page
      .locator(".inspector-section")
      .filter({ hasText: "Typography" })
      .getByRole("textbox", { name: "Text", exact: true })
      .fill("MARKET DATA METHODOLOGY");

    const selected = page.getByTestId(methodologyLogoId);
    await selected.click();
    const before = await selected.evaluate((node) => {
      const element = node as HTMLElement;
      return {
        left: element.style.left,
        top: element.style.top,
        width: element.style.width,
        height: element.style.height,
        transform: element.style.transform,
        opacity: element.style.opacity,
        src: element.querySelector("img")?.getAttribute("src"),
      };
    });
    await page.getByRole("button", { name: "Replace Image" }).click();
    await expect(
      page.getByText("Choose or upload a managed image"),
    ).toBeVisible();
    const replacementOptions = page.locator(".asset-grid button");
    const replacementIndex = await replacementOptions.evaluateAll(
      (buttons, currentSource) =>
        buttons.findIndex(
          (button) =>
            button.querySelector("img")?.getAttribute("src") !== currentSource,
        ),
      before.src,
    );
    expect(replacementIndex).toBeGreaterThanOrEqual(0);
    const replacement = replacementOptions.nth(replacementIndex);
    const replacementName = await replacement.locator("span").innerText();
    await replacement.click();

    await expect(page.getByTestId(methodologyLogoId)).toHaveCount(1);
    const after = await selected.evaluate((node) => {
      const element = node as HTMLElement;
      return {
        left: element.style.left,
        top: element.style.top,
        width: element.style.width,
        height: element.style.height,
        transform: element.style.transform,
        opacity: element.style.opacity,
        src: element.querySelector("img")?.getAttribute("src"),
      };
    });
    expect(after).toMatchObject({
      left: before.left,
      top: before.top,
      width: before.width,
      height: before.height,
      transform: before.transform,
      opacity: before.opacity,
    });
    expect(after.src).not.toBe(before.src);
    await expect(
      page
        .locator(".inspector-section")
        .filter({ hasText: "Image" })
        .getByLabel("Crop zoom"),
    ).toHaveValue("100");
    await expect(page.getByLabel("Crop X")).toHaveValue("50");
    await expect(page.getByLabel("Crop Y")).toHaveValue("50");

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
      template: {
        pages: Array<{
          id: string;
          elements: Array<{
            id: string;
            type: string;
            text?: string;
            assetId?: string;
            src?: string;
            crop?: { x: number; y: number; zoom: number };
            binding?: { path: string };
          }>;
        }>;
      };
    };
    const methodology = stored.template.pages.find(
      (candidate) => candidate.id === "data-methodology",
    )!;
    expect(
      methodology.elements.filter(
        (element) => element.id === methodologyLogoId,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "image",
        assetId: expect.any(String),
        src: expect.stringMatching(/^\/api\/assets\//),
        crop: { x: 50, y: 50, zoom: 1 },
      }),
    ]);
    expect(
      methodology.elements.find(
        (element) => element.id === "data-methodology-title",
      )?.text,
    ).toBe("MARKET DATA METHODOLOGY");
    expect(
      methodology.elements.find(
        (element) => element.id === "data-methodology-period",
      )?.binding,
    ).toEqual({ path: "reportDisplay.period" });

    const pdfResponse = await page.request.post("/api/render/pdf", {
      data: {
        template: stored.template,
        data: { reportDisplay: { period: "Q2 2026" } },
        title: "Managed image replacement persistence",
      },
      timeout: 90_000,
    });
    expect(pdfResponse.ok()).toBe(true);
    expect(
      (await PDFDocument.load(await pdfResponse.body())).getPageCount(),
    ).toBe(10);

    await page.reload({ waitUntil: "networkidle" });
    await openTemplatePage(page, created.version, "Data Methodology");
    await expect(
      page.getByText("MARKET DATA METHODOLOGY", { exact: true }),
    ).toHaveCount(1);
    await selected.click();
    await expect(selected.locator("img")).toHaveAttribute(
      "src",
      /\/api\/assets\//,
    );
    expect(replacementName.length).toBeGreaterThan(0);

    await openTemplatePage(page, created.version, "Definitions");
    await selectLayer(page, /DEFINITIONS.*text/i);
    await expect(page.locator(".inspector")).toContainText("text");
    await selectLayer(page, /Report Period.*text/i);
    await expect(page.locator(".inspector")).toContainText("text");
    await page.getByTestId(definitionsLogoId).click();
    await expect(
      page.getByRole("button", { name: "Replace Image" }),
    ).toBeVisible();

    await openTemplatePage(page, created.version, "Contacts");
    await selectLayer(page, /Report Period.*text/i);
    await expect(page.locator(".inspector")).toContainText("text");
    await page.getByTestId(contactsLogoId).click();
    await expect(
      page.getByRole("button", { name: "Replace Image" }),
    ).toBeVisible();

    await page.locator(".rail").getByTitle("Fonts").click();
    await expect(page.locator(".left-panel")).toContainText(
      "Avenir Next LT Pro",
    );
    await expect(page.locator(".left-panel")).toContainText(
      "Organization-owned commercial font license",
    );
  } finally {
    await page.request.delete(createdUrl).catch(() => undefined);
  }
});

test("static page header backgrounds are directly selectable, editable, and persist", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sourceResponse = await page.request.get(
    `/api/templates/${templateId}/versions/1.8.0`,
  );
  test.skip(!sourceResponse.ok(), "The governed v1.8.0 draft is unavailable.");
  const source = (await sourceResponse.json()) as StaticHeaderSource;
  const createResponse = await page.request.post(
    `/api/templates/${templateId}/versions/1.8.0/new`,
    { data: { template: source.template } },
  );
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { version: string };
  const createdUrl = `/api/templates/${templateId}/versions/${created.version}`;
  const staticPages = [
    ["data-methodology", "Data Methodology"],
    ["definitions", "Definitions"],
    ["contacts", "Contacts"],
  ] as const;

  try {
    await page.goto("/", { waitUntil: "networkidle" });
    // Open the draft once; re-invoking "Open Draft" per page (as
    // openTemplatePage does) would re-fetch it from the server on every
    // iteration and discard the previous iteration's unsaved in-memory edit.
    await openTemplatePage(page, created.version, staticPages[0][1]);

    for (const [id, name] of staticPages) {
      if (name !== staticPages[0][1]) {
        await page
          .locator(".page-list")
          .getByRole("button", { name: new RegExp(`${name}$`) })
          .click();
        await expect(page.locator(".stage-topline span").first()).toHaveText(
          name,
        );
      }
      const headerMask = page.getByTestId(`${id}-header-mask`);
      await headerMask.click();
      await expect(
        page.locator(".canvas-element.is-selected"),
      ).toHaveAttribute("data-testid", `${id}-header-mask`);

      const inspector = page.locator("aside.inspector");
      await expect(inspector).toContainText("Native Header Background");
      await expect(
        inspector.locator(".inspector-section").filter({ hasText: "Fill" }),
      ).toBeVisible();

      await expect(headerMask).toHaveCSS("height", "110px");
      // The Inspector displays width/height in the document's configured
      // unit (px or in), not always raw pixels — convert rather than assume.
      const positionSection = inspector
        .locator(".inspector-section")
        .filter({ hasText: "Position & Size" });
      const heightField = positionSection.locator("input[type=number]").nth(3);
      const isInches = (await heightField.getAttribute("step")) === "0.01";
      const targetHeightPx = 120;
      await heightField.fill(
        isInches ? (targetHeightPx / 96).toFixed(3) : String(targetHeightPx),
      );
      await heightField.blur();
      await expect(headerMask).toHaveCSS("height", `${targetHeightPx}px`);

      // Clicking the title/period/logo still resolves to those elements,
      // not the now-selectable background sitting behind them.
      const logo = logoId(source, id);
      await page.getByTestId(logo).click();
      await expect(
        page.locator(".canvas-element.is-selected"),
      ).toHaveAttribute("data-testid", logo);
    }

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
      template: {
        pages: Array<{
          id: string;
          elements: Array<{ id: string; height?: number; locked?: boolean }>;
        }>;
      };
    };
    for (const [id] of staticPages) {
      const headerMask = stored.template.pages
        .find((candidate) => candidate.id === id)!
        .elements.find((element) => element.id === `${id}-header-mask`);
      expect(headerMask?.height).toBe(120);
      expect(headerMask?.locked).toBeFalsy();
    }

    const pdfResponse = await page.request.post("/api/render/pdf", {
      data: {
        template: stored.template,
        data: { reportDisplay: { period: "Q2 2026" } },
        title: "Header background persistence",
      },
      timeout: 90_000,
    });
    expect(pdfResponse.ok(), await pdfResponse.text()).toBe(true);
    expect(
      (await PDFDocument.load(await pdfResponse.body())).getPageCount(),
    ).toBe(10);

    await page.reload({ waitUntil: "networkidle" });
    await openTemplatePage(page, created.version, staticPages[0][1]);
    await expect(
      page.getByTestId(`${staticPages[0][0]}-header-mask`),
    ).toHaveCSS("height", "120px");
  } finally {
    await page.request.delete(createdUrl).catch(() => undefined);
  }
});

test("static page footers are directly selectable, editable, and persist", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sourceResponse = await page.request.get(
    `/api/templates/${templateId}/versions/1.8.0`,
  );
  test.skip(!sourceResponse.ok(), "The governed v1.8.0 draft is unavailable.");
  const source = (await sourceResponse.json()) as { template: unknown };
  const createResponse = await page.request.post(
    `/api/templates/${templateId}/versions/1.8.0/new`,
    { data: { template: source.template } },
  );
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { version: string };
  const createdUrl = `/api/templates/${templateId}/versions/${created.version}`;
  const staticPages = [
    ["data-methodology", "Data Methodology"],
    ["definitions", "Definitions"],
    ["contacts", "Contacts"],
    ["who-we-are", "Who We Are"],
  ] as const;

  try {
    await page.goto("/", { waitUntil: "networkidle" });
    await openTemplatePage(page, created.version, "Market Overview");
    const chips = page.getByTestId("lee-deal-chip");
    await expect(chips).toHaveCount(2);
    for (const chip of await chips.all()) {
      await expect(chip).toHaveAttribute(
        "data-font-asset-id",
        "cbd29e47-19e9-4dcb-9869-41222eed39da",
      );
      await expect(chip).toHaveAttribute(
        "data-font-checksum",
        "8208722ef891169364b69dc333c5af7a11e9a69070d7b056782d23bf0761f865",
      );
      await expect(chip).toHaveCSS("font-weight", "900");
      await expect(chip).toHaveCSS("font-style", "normal");
      await expect(chip).toHaveCSS(
        "font-family",
        /LEE Managed cbd29e47-19e9-4dcb-9869-41222eed39da/,
      );
    }
    const goToStaticPage = async (name: string) => {
      await page
        .locator(".page-list")
        .getByRole("button", { name: new RegExp(`${name}$`) })
        .click();
      await expect(page.locator(".stage-topline span").first()).toHaveText(
        name,
      );
    };
    for (const [id, name] of staticPages) {
      await goToStaticPage(name);
      await page.getByTestId(`${id}-footer-address`).click();
      await expect(page.locator(".canvas-element.is-selected")).toHaveAttribute(
        "data-testid",
        `${id}-footer-address`,
      );
      const editor = page
        .locator(".inspector-section")
        .filter({ hasText: "Typography" })
        .getByRole("textbox", { name: "Text", exact: true });
      await expect(editor).toBeVisible();
      await editor.fill(`${name} footer QA`);
      await expect(
        page.getByTestId(`${id}-footer-address`).locator(".text-value"),
      ).toHaveText(`${name} footer QA`);
    }

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

    await page.reload({ waitUntil: "networkidle" });
    await openTemplatePage(page, created.version, staticPages[0][1]);
    for (const [id, name] of staticPages) {
      await goToStaticPage(name);
      await expect(
        page.getByTestId(`${id}-footer-address`).locator(".text-value"),
      ).toHaveText(`${name} footer QA`);
    }
  } finally {
    await page.request.delete(createdUrl).catch(() => undefined);
  }
});
