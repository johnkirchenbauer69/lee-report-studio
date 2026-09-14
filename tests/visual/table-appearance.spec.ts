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

/**
 * Exercises the four representative scenarios called out in the table
 * appearance spec: a whole-table drop shadow (Overall Market Table), a
 * standalone raised header bevel with rounded outer corners (Market
 * Indicators), the Top Leases header + linked side ribbon rendering as one
 * continuous beveled group with no internal seam, and region-scoped
 * header/body text shadows — verified through save, PDF export, and reload.
 */
test("table appearance controls persist and render consistently across editor, save, PDF, and reload", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const sourceResponse = await page.request.get(
    `/api/templates/${templateId}/versions/1.8.0`,
  );
  test.skip(!sourceResponse.ok(), "The governed v1.8.0 draft is unavailable.");
  const source = (await sourceResponse.json()) as {
    status: string;
    template: { pages: unknown[] };
  };
  test.skip(
    source.status !== "draft",
    "v1.8.0 must be a draft to safely mutate for this test.",
  );

  const createResponse = await page.request.post(
    `/api/templates/${templateId}/versions/1.8.0/new`,
    { data: { template: source.template } },
  );
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { version: string };
  const createdUrl = `/api/templates/${templateId}/versions/${created.version}`;

  try {
    await page.goto("/", { waitUntil: "load" });

    // A. Overall Market Table: a whole-table drop shadow, applied once at
    // the container level (never per-cell).
    await openTemplatePage(page, created.version, "Overall Market Table");
    const matrixNode = page.getByTestId("submarket-matrix");
    await matrixNode.evaluate((node) => (node as HTMLElement).click());
    const tableShadow = section(page, "Table Shadow");
    await expect(tableShadow).toBeVisible();
    await tableShadow.getByLabel("Table Shadow").check();
    await tableShadow
      .getByRole("textbox", { name: "Table Shadow color" })
      .fill("#1a1a1a");
    await tableShadow.getByLabel("Table Shadow X Offset").fill("0");
    await tableShadow.getByLabel("Table Shadow Y Offset").fill("2");
    await tableShadow.getByLabel("Table Shadow Blur").fill("6");
    await tableShadow.getByLabel("Table Shadow Opacity").fill("30");
    await expect(matrixNode).toHaveCSS(
      "box-shadow",
      "rgba(26, 26, 26, 0.3) 0px 2px 6px 0px",
    );

    await openTemplatePage(page, created.version, "Market Overview");

    // B. Market Indicators: a subtle raised header bevel with rounded outer
    // corners, and no bevel/radius leaking into body rows.
    const indicatorNode = page.getByTestId("indicator-table");
    await indicatorNode.evaluate((node) => (node as HTMLElement).click());
    const indicatorHeaderAppearance = section(page, "Header Appearance");
    await expect(indicatorHeaderAppearance).toBeVisible();
    await indicatorHeaderAppearance.getByLabel("Header Bevel").check();
    await indicatorHeaderAppearance.getByLabel("Bevel size").fill("2");
    await indicatorHeaderAppearance.getByLabel("Header corner radius").fill("6");
    const indicatorFirstHeaderCell = indicatorNode.locator("thead th").first();
    const indicatorLastHeaderCell = indicatorNode.locator("thead th").last();
    await expect(indicatorFirstHeaderCell).toHaveCSS(
      "border-top-left-radius",
      "6px",
    );
    await expect(indicatorLastHeaderCell).toHaveCSS(
      "border-top-right-radius",
      "6px",
    );
    await expect(
      await indicatorFirstHeaderCell.evaluate(
        (node) => getComputedStyle(node).boxShadow,
      ),
    ).toMatch(/inset/);
    await expect(
      await indicatorNode
        .locator("tbody td")
        .first()
        .evaluate((node) => getComputedStyle(node).boxShadow),
    ).toBe("none");

    // C. Top Leases: header row + linked side ribbon read as one continuous
    // beveled group — outer corners round, the shared internal edge does not.
    const leasesNode = page.getByTestId("top-leases-table");
    await leasesNode.evaluate((node) => (node as HTMLElement).click());
    const leasesHeaderAppearance = section(page, "Header Appearance");
    await leasesHeaderAppearance.getByLabel("Header Bevel").check();
    await leasesHeaderAppearance.getByLabel("Bevel size").fill("3");
    await leasesHeaderAppearance.getByLabel("Header corner radius").fill("6");
    await leasesHeaderAppearance
      .getByLabel("Header ribbon link")
      .selectOption("leases-side-bg");

    const ribbonNode = page.getByTestId("leases-side-bg");
    await expect(ribbonNode).toHaveCSS("border-radius", "6px 0px 6px 6px");
    const leasesFirstHeaderCell = leasesNode.locator("thead th").first();
    const leasesLastHeaderCell = leasesNode.locator("thead th").last();
    // The corner touching the ribbon (table's top-left) stays square; the
    // true outer corner (table's top-right) rounds.
    await expect(leasesFirstHeaderCell).toHaveCSS(
      "border-top-left-radius",
      "0px",
    );
    await expect(leasesLastHeaderCell).toHaveCSS(
      "border-top-right-radius",
      "6px",
    );
    const ribbonBoxShadow = await ribbonNode.evaluate(
      (node) => getComputedStyle(node).boxShadow,
    );
    // No shadow layer offset toward the shared right edge (a positive-x
    // inset offset there would be the doubled-border/seam failure mode).
    expect(ribbonBoxShadow).not.toMatch(/inset -\d/);

    // D. Header and body text shadow are independently controllable and
    // stay scoped to their own region.
    const textEffects = section(page, "Text Effects");
    await expect(textEffects).toBeVisible();
    await textEffects.getByLabel("Header Text Shadow").check();
    await textEffects
      .getByRole("textbox", { name: "Header Text Shadow color" })
      .fill("#000000");
    await textEffects.getByLabel("Header Text Shadow X Offset").fill("0");
    await textEffects.getByLabel("Header Text Shadow Y Offset").fill("1");
    await textEffects.getByLabel("Header Text Shadow Blur").fill("1");
    await textEffects.getByLabel("Header Text Shadow Opacity").fill("60");
    await expect(leasesFirstHeaderCell).toHaveCSS(
      "text-shadow",
      "rgba(0, 0, 0, 0.6) 0px 1px 1px",
    );
    await textEffects.getByLabel("Body Text Shadow").check();
    await textEffects
      .getByRole("textbox", { name: "Body Text Shadow color" })
      .fill("#224466");
    await textEffects.getByLabel("Body Text Shadow X Offset").fill("0");
    await textEffects.getByLabel("Body Text Shadow Y Offset").fill(".5");
    await textEffects.getByLabel("Body Text Shadow Blur").fill("1");
    await textEffects.getByLabel("Body Text Shadow Opacity").fill("50");
    const leasesFirstBodyCell = leasesNode.locator("tbody td").first();
    await expect(leasesFirstBodyCell).toHaveCSS(
      "text-shadow",
      "rgba(34, 68, 102, 0.5) 0px 0.5px 1px",
    );
    // Text shadow on the body must not bleed into the header, and vice versa.
    await expect(
      await leasesFirstHeaderCell.evaluate(
        (node) => getComputedStyle(node).textShadow,
      ),
    ).not.toContain("rgba(34, 68, 102");

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
          elements: Array<Record<string, unknown> & { id: string }>;
        }>;
      };
    };
    const marketOverviewPage = stored.template.pages.find(
      (candidate) => candidate.id === "market-overview",
    )!;
    const storedLeasesTable = marketOverviewPage.elements.find(
      (element) => element.id === "top-leases-table",
    )!;
    expect(storedLeasesTable).toMatchObject({
      headerRibbonId: "leases-side-bg",
      headerCornerRadius: 6,
      headerBevel: { enabled: true, size: 3 },
      headerStyle: { shadow: { enabled: true, color: "#000000" } },
      bodyStyle: { shadow: { enabled: true, color: "#224466" } },
    });
    const overallTablePage = stored.template.pages.find(
      (candidate) => candidate.id === "overall-table",
    )!;
    expect(
      (
        overallTablePage.elements.find(
          (element) => element.id === "submarket-matrix",
        )! as { style: Record<string, unknown> }
      ).style,
    ).toMatchObject({ shadow: { enabled: true, color: "#1a1a1a" } });

    const pdfResponse = await page.request.post("/api/render/pdf", {
      data: {
        template: stored.template,
        data: {},
        title: "Table appearance persistence",
      },
      timeout: 90_000,
    });
    expect(pdfResponse.ok()).toBe(true);
    expect(
      (await PDFDocument.load(await pdfResponse.body())).getPageCount(),
    ).toBe(stored.template.pages.length);

    await page.reload({ waitUntil: "load" });
    await openTemplatePage(page, created.version, "Market Overview");
    await expect(page.getByTestId("top-leases-table").locator("thead th").last()).toHaveCSS(
      "border-top-right-radius",
      "6px",
    );
    await expect(page.getByTestId("leases-side-bg")).toHaveCSS(
      "border-radius",
      "6px 0px 6px 6px",
    );
  } finally {
    await page.request.delete(createdUrl).catch(() => undefined);
  }
});
