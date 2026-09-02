import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

test("generated unavailable copy remains exactly pinned through publication preflight", async ({
  page,
}) => {
  const live = process.env.LIVE_Q2_FONT_PREFLIGHT === "1";
  test.setTimeout(live ? 180_000 : 90_000);
  const templatesResponse = await page.request.get("/api/templates");
  const assetsResponse = await page.request.get("/api/assets");
  test.skip(
    !templatesResponse.ok() || !assetsResponse.ok(),
    "The durable template and managed asset APIs are not running.",
  );
  const templateSummaries = (await templatesResponse.json()) as {
    templates: Array<{
      id: string;
      version: string;
      status: "draft" | "published" | "archived";
    }>;
  };
  const published = templateSummaries.templates.find(
    (template) => template.status === "published",
  );
  test.skip(!published, "A published template is required.");

  await page.goto("/", { waitUntil: "load" });
  const result = await page.evaluate(
    async (summary) => {
      const [
        templateModule,
        preparationModule,
        repeatersModule,
        modelModule,
        sampleModule,
        schemaModule,
        registryModule,
        preflightModule,
      ] = await Promise.all([
        import("/src/services/templateNormalization.ts"),
        import("/src/report-engine/generation/prepareTemplate.ts"),
        import("/src/report-engine/generation/repeaters.ts"),
        import("/src/report-engine/bindings/presentationModel.ts"),
        import("/src/data-providers/sample/q2SampleReport.ts"),
        import("/src/report-engine/schema/industrialMarketReport.ts"),
        import("/src/services/fontRegistry.ts"),
        import("/src/report-engine/validation/exportPreflight.ts"),
      ]);
      const [storedResponse, assetsResponse] = await Promise.all([
        fetch(
          `/api/templates/${encodeURIComponent(summary.id)}/versions/${encodeURIComponent(summary.version)}`,
        ),
        fetch("/api/assets"),
      ]);
      const stored = await storedResponse.json();
      const assets = (await assetsResponse.json()).assets;
      const source = templateModule.normalizeReportTemplateFonts(
        { ...stored.template, assets },
        assets,
      );
      await registryModule.installManagedFonts(assets);
      let report = structuredClone(sampleModule.q2SampleReport);
      if (summary.live) {
        const reportResponse = await fetch(
          "/api/report-data/industrial-market",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              reportType: "industrial-market-report",
              market: "Chicago",
              period: "2026 Q2",
              calculationScope: { type: "all-submarkets" },
              timeContext: { type: "historical-period", period: "2026 Q2" },
            }),
          },
        );
        if (!reportResponse.ok)
          throw new Error(
            `Live report request failed: ${reportResponse.status}`,
          );
        report = schemaModule.industrialMarketReportSchema.parse(
          (await reportResponse.json()).report,
        );
      } else {
        report.dataCompleteness = report.dataCompleteness.map((item) =>
          item.section === "construction"
            ? { ...item, status: "missing" }
            : item,
        );
      }
      const presentation = modelModule.buildPresentationModel(report);
      const prepared = preparationModule.prepareTemplateForReport(
        source,
        report,
        presentation,
        "ascendix",
        "editor",
      );
      const pages = repeatersModule.expandTemplatePages(
        prepared,
        presentation,
        summary.live
          ? {
              submarketIds: report.submarkets
                .map((submarket) => submarket.id)
                .filter((id): id is string => Boolean(id)),
            }
          : undefined,
      );
      const publication = preparationModule.prepareTemplateForPublication({
        ...prepared,
        pages,
      });
      const placeholders = publication.pages.flatMap((reportPage) =>
        reportPage.elements
          .filter(
            (element) =>
              element.type === "text" && element.name === "Data unavailable",
          )
          .map((element) => ({
            id: element.id,
            text: element.text,
            assetId:
              element.style.typography?.fontAssetId ??
              element.style.fontAssetId,
            checksum:
              element.style.typography?.fontChecksum ??
              element.style.fontChecksum,
          })),
      );
      const issues = await preflightModule.runExportPreflight(publication);
      return {
        pageCount: publication.pages.length,
        placeholders,
        fontErrors: issues
          .filter((issue) => issue.kind === "font" && issue.level === "error")
          .map((issue) => issue.message),
      };
    },
    { ...published!, live },
  );

  expect(result.pageCount).toBe(44);
  expect(result.placeholders.length).toBeGreaterThan(0);
  expect(result.fontErrors).toEqual([]);
  expect(
    result.placeholders.every(
      (placeholder) =>
        placeholder.text === "Content not available for this edition" &&
        Boolean(placeholder.assetId) &&
        Boolean(placeholder.checksum),
    ),
  ).toBe(true);

  if (live) {
    await page.locator(".create-report-top").click();
    const dialog = page.getByRole("dialog", { name: "Create report" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: /Ascendix/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Select all" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Generate Report" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 60_000 });
    await page.locator(".rail").getByTitle("Templates").click();
    await expect(page.locator(".page-list > button")).toHaveCount(44);

    const downloadPromise = page.waitForEvent("download", {
      timeout: 120_000,
    });
    await page.getByRole("button", { name: "Export PDF" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const pdf = await PDFDocument.load(await readFile(downloadPath!));
    expect(pdf.getPageCount()).toBe(44);
  }
});
