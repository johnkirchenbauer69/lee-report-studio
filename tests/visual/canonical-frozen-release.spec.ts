import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

// Opt-in release acceptance using a private, approved frozen snapshot and an
// independently prepared test store. No Salesforce calls or normal-store writes.
const fixturePath = process.env.LEE_CANONICAL_QA_FIXTURE;
for (const family of ["Classic", "Geographic"])
  test(`frozen canonical ${family}: create, save, reopen and inspect 44 pages`, async ({
    page,
  }, info) => {
    test.skip(
      !fixturePath,
      "Requires approved frozen snapshot and canonical test store",
    );
    test.setTimeout(300000);
    const fixture = JSON.parse(await readFile(fixturePath!, "utf8"));
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const broken: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400 && /\/api\/assets\/.+\/content/.test(r.url()))
        broken.push(r.url());
    });
    await page.route("**/api/report-data/industrial-market", (r) =>
      r.fulfill({ json: fixture }),
    );
    await page.route("**/api/report-data/industrial-market/periods", (r) =>
      r.fulfill({
        json: {
          mode: "salesforce",
          periods: [
            { label: fixture.report.report.period, year: 2026, quarter: 3 },
          ],
        },
      }),
    );
    await page.goto("/");
    await page
      .getByRole("button", { name: "Create New Report", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create report" });
    await dialog
      .getByRole("radio", {
        name: new RegExp(`Industrial Market Report: ${family}`),
      })
      .click();
    await page.screenshot({
      path: info.outputPath("template-selection.png"),
      fullPage: true,
    });
    for (let i = 0; i < 4; i++)
      await dialog
        .getByRole("button", { name: "Continue", exact: true })
        .click();
    const created = page
      .waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/api/report-instances"),
        { timeout: 60000 },
      )
      .catch(() => undefined);
    await dialog.getByRole("button", { name: "Load & Validate Data" }).click();
    const response = await created;
    if (!response)
      throw Error(
        (await dialog
          .locator(".wizard-error")
          .textContent({ timeout: 1000 })
          .catch(() => "Report creation did not complete")) ||
          "Report creation failed",
      );
    expect(response.ok(), await response.text()).toBeTruthy();
    const saved = await response.json();
    expect(saved.pages).toHaveLength(44);
    expect(saved.dataSnapshot.submarketDetails).toHaveLength(18);
    expect(
      saved.dataSnapshot.submarketDetails.filter(
        (d: any) => d.featuredAvailability?.status === "selected",
      ),
    ).toHaveLength(17);
    expect(saved.sourceSnapshotHash).toBe(fixture.snapshot.hash);
    await expect(dialog.getByTestId("narrative-workspace")).toBeVisible();
    await dialog.getByRole("button", { name: "Review Report" }).click();
    await dialog.getByRole("button", { name: "Open Report Editor" }).click();
    await expect(
      page.getByRole("button", { name: "Export to InDesign", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: /Pages$/ })
      .click({ timeout: 10000 });
    await expect(page.locator(".page-list > button")).toHaveCount(44);
    for (const n of [0, 1, 2, 3, 4, 5, 26, 27, 38, 39, 40, 41, 42, 43]) {
      await page.locator(".page-list > button").nth(n).click();
      await page.screenshot({
        path: info.outputPath(`page-${n + 1}.png`),
        fullPage: true,
      });
    }
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Export to InDesign", exact: true }),
    ).toBeEnabled();
    const pdfDownload = page.waitForEvent("download", { timeout: 180000 });
    await page.getByRole("button", { name: "Export PDF", exact: true }).click();
    const warning = page.getByRole("button", {
      name: "Export anyway",
      exact: true,
    });
    // Preflight is asynchronous; wait for the acknowledgment rather than
    // checking visibility immediately after the Export click.
    await expect(warning).toBeVisible({ timeout: 30000 });
    await warning.click();
    const downloaded = await pdfDownload;
    const pdfPath = info.outputPath(`${family.toLowerCase()}-44-pages.pdf`);
    await downloaded.saveAs(pdfPath);
    const pdf = await PDFDocument.load(await readFile(pdfPath));
    expect(pdf.getPageCount()).toBe(44);
    expect(errors).toEqual([]);
    expect(broken).toEqual([]);
  });
