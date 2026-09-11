import { expect, test } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import type { ReportInstance } from "../../src/report-engine/schema/generation";
import { CHICAGO_SUBMARKETS } from "../../src/report-engine/submarkets";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "../../src/types/templateLibrary";

const reportKey = "lee-report-studio.report-instance.v1";

test("Overall Market links navigate to stable overview pages without saving", async ({
  page,
  request,
}) => {
  const library = (await (await request.get("/api/templates")).json()) as {
    templates: TemplateVersionSummary[];
  };
  const summary =
    library.templates.find((item) => item.status === "published") ??
    library.templates[0]!;
  const source = (await (
    await request.get(
      `/api/templates/${summary.id}/versions/${summary.version}`,
    )
  ).json()) as StoredTemplateVersion;
  const submarketIds = CHICAGO_SUBMARKETS.map((submarket) => submarket.id);
  const instance = await generateReportInstance(source.template, {
    templateId: source.id,
    templateVersion: source.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds },
    source: { provider: "sample" },
  });
  instance.id = `report-${crypto.randomUUID()}`;
  const create = await request.post("/api/report-instances", {
    data: instance,
  });
  expect(create.ok()).toBeTruthy();
  const persisted = (await create.json()) as ReportInstance;

  await page.addInitScript(({ key, id }) => localStorage.setItem(key, id), {
    key: reportKey,
    id: persisted.id,
  });
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator(".statusbar")).toContainText("Report saved at");
  await page.waitForTimeout(300);
  await page.locator(".rail").getByTitle("Templates").click();
  await expect(page.locator(".page-list > button")).toHaveCount(44);
  const overallTableButton = page
    .locator(".page-list > button")
    .filter({ hasText: "Overall Market Table" });
  await overallTableButton.evaluate((button) =>
    (button as HTMLButtonElement).click(),
  );
  await expect(overallTableButton).toHaveClass(/active/);
  await expect(page.getByTestId("submarket-matrix")).toBeVisible();

  const links = page.locator(".report-internal-link");
  await expect(links).toHaveCount(18);
  const hrefs = await links.evaluateAll((items) =>
    items.map((item) => item.getAttribute("href")),
  );
  expect(new Set(hrefs).size).toBe(18);
  expect(hrefs).toContain("#ohare-overview");
  expect(hrefs).toContain("#west-cook-overview");

  let documentWrites = 0;
  page.on("request", (outgoing) => {
    if (
      outgoing.method() !== "GET" &&
      outgoing.url().includes(`/api/report-instances/${persisted.id}/document`)
    )
      documentWrites += 1;
  });
  const revisionBefore = (
    (await (
      await request.get(`/api/report-instances/${persisted.id}`)
    ).json()) as ReportInstance
  ).revision;

  const ohare = page.getByRole("link", {
    name: "Go to O'Hare Market Overview",
  });
  await ohare.focus();
  await expect(ohare).toBeFocused();
  await ohare.press("Enter");
  const targetButton = page
    .locator(".page-list > button")
    .filter({ hasText: "O'Hare Overview" });
  await expect(targetButton).toHaveClass(/active/);
  await expect(page.getByTestId("detail-market-map")).toBeVisible();
  await page.waitForTimeout(750);

  const revisionAfter = (
    (await (
      await request.get(`/api/report-instances/${persisted.id}`)
    ).json()) as ReportInstance
  ).revision;
  expect(revisionAfter).toBe(revisionBefore);
  expect(documentWrites).toBe(0);

  const pdfResponse = await request.post("/api/render/pdf", {
    data: {
      template: {
        ...source.template,
        name: "Navigation acceptance",
        pages: persisted.pages,
      },
      data: buildPresentationModel(persisted.dataSnapshot),
      title: "Navigation acceptance",
    },
  });
  expect(pdfResponse.ok()).toBeTruthy();
  const pdf = await PDFDocument.load(await pdfResponse.body());
  expect(pdf.getPageCount()).toBe(44);
  const annotations = pdf
    .getPage(1)
    .node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  expect(annotations?.size()).toBe(18);
  const destinations = Array.from(
    { length: annotations?.size() ?? 0 },
    (_, index) => {
      const annotation = pdf.context.lookup(annotations!.get(index), PDFDict);
      const direct = annotation.get(PDFName.of("Dest"));
      const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
      const destination = direct ?? action?.get(PDFName.of("D"));
      return destination instanceof PDFArray
        ? destination.get(0).toString()
        : destination?.toString();
    },
  );
  for (const anchor of ["ohare-overview", "west-cook-overview"]) {
    const targetIndex = persisted.pages.findIndex(
      (candidate) => candidate.anchor === anchor,
    );
    expect(targetIndex).toBeGreaterThan(-1);
    expect(destinations).toContain(`/${anchor}`);
  }
});
