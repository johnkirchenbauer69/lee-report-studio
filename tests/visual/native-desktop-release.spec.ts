import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { open } from "yauzl";

const reports = process.env.LEE_NATIVE_QA_REPORTS?.split(",") ?? [];
for (const reportPath of reports)
  test(`operator-started native package ${path.basename(reportPath)}`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(20 * 60 * 1000);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    await page.goto(
      `/?workspace=editor&report=${encodeURIComponent(report.id)}`,
    );
    const button = page.getByRole("button", {
      name: "Export to InDesign",
      exact: true,
    });
    await expect(button).toBeEnabled({ timeout: 30000 });
    const accepted = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/indesign/jobs") &&
        r.request().method() === "POST",
    );
    await button.click();
    const response = await accepted;
    expect(response.status(), await response.text()).toBe(202);
    const initial = await response.json();
    await expect
      .poll(
        async () => {
          const result = await request.get(`/api/indesign/jobs/${initial.id}`);
          const job = await result.json();
          if (job.state === "failed") throw Error(job.message);
          return job.state;
        },
        { timeout: 18 * 60 * 1000, intervals: [3000, 5000] },
      )
      .toBe("complete");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download InDesign package" }).click();
    const download = await downloadPromise;
    const destination = info.outputPath(`${report.templateId}.zip`);
    await download.saveAs(destination);
    const entries = await new Promise<string[]>((resolve, reject) =>
      open(destination, { lazyEntries: true }, (error, zip) => {
        if (error || !zip) return reject(error);
        const names: string[] = [];
        zip.on("entry", (entry) => {
          names.push(entry.fileName);
          zip.readEntry();
        });
        zip.on("end", () => resolve(names));
        zip.on("error", reject);
        zip.readEntry();
      }),
    );
    for (const name of [
      "Report.indd",
      "Report.pdf",
      "report.json",
      "input.json",
      "master.json",
      "validation.json",
      "READ-ME.txt",
      "Document fonts/Font-licenses.txt",
    ])
      expect(entries).toContain(name);
    expect(entries.some((n) => n.startsWith("Links/"))).toBe(true);
    expect(entries.some((n) => n.startsWith("Assets/"))).toBe(true);
    expect(entries.some((n) => n.endsWith(".idml"))).toBe(false);
    await page.screenshot({
      path: info.outputPath("completed-package.png"),
      fullPage: true,
    });
  });
// Desktop execution is never part of an unattended/default browser test run.
test("native package QA requires explicit operator opt-in", () => {
  test.skip(reports.length > 0);
  expect(reports).toEqual([]);
});
