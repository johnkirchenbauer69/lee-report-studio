import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import type { ReportInstance } from "../../src/report-engine/schema/generation";

test("table display override survives save/reopen, prints in PDF, and clears to authoritative null", async ({ page, request }) => {
  test.setTimeout(90_000);
  const instance = await generateReportInstance(sampleTemplate, { templateId: sampleTemplate.id, templateVersion: sampleTemplate.version,
    market: "Chicago", period: "2026 Q2", calculationScope: { type: "all-submarkets" }, pageSelection: { submarketIds: [] }, source: { provider: "sample" } });
  const overview = instance.pages.find((item) => item.id === "market-overview")!;
  const table = overview.elements.find((item) => item.type === "table" && item.variant === "indicators")!;
  if (table.type !== "table") throw new Error("Indicator table missing");
  instance.pages = [{ ...overview, elements: [table] }];
  const periods = ["2026 Q3", "2026 Q2", "2026 Q1", "2025 Q4", "2025 Q3"];
  const values = [19_417_314, 17_654_829, 17_675_415, 18_086_895, null];
  instance.dataSnapshot.historicalPeriods = instance.dataSnapshot.historicalPeriods.slice(0, 5).map((item, index) => ({
    ...item, period: periods[index]!, trailing12MonthNetAbsorptionSf: values[index]!,
    trailing12MonthNetAbsorptionStatus: index === 4 ? "authoritative_null" : "complete",
  }));
  table.columns = table.columns.map((column, index) => index ? { ...column, label: periods[index - 1]!.replace(/(\d+) Q(\d)/, "Q$2 $1") } : column);
  const original = structuredClone(instance.dataSnapshot);
  const response = await request.post("/api/report-instances", { data: instance });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.addInitScript((id) => {
    localStorage.setItem("lee-report-studio.report-instance.v1", id);
    localStorage.removeItem("lee-report-studio.template.v1");
  }, instance.id);
  await page.goto("/");
  const node = page.getByTestId(table.id);
  const cell = node.locator("tbody tr").first().locator("td").last();
  await expect(cell).toHaveText("—");
  await node.evaluate((element) => (element as HTMLElement).click());
  await page.getByRole("button", { name: "Edit table", exact: true }).click();
  await cell.click();
  await expect(page.getByLabel("Table cell display value")).toHaveValue("—");
  const source = await page.getByLabel("Table cell source").inputValue();
  await page.getByLabel("Override display value", { exact: true }).fill("=SUM(A1:A4)");
  await expect(page.getByRole("button", { name: "Apply override" })).toBeDisabled();
  await page.getByLabel("Override display value", { exact: true }).fill("18,086,895");
  await page.getByRole("button", { name: "Apply override" }).click();
  await expect(cell).toHaveText("18,086,895");
  await expect(page.getByText("Manual override active", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Table cell source")).toHaveValue(source);
  await expect(page.locator(".statusbar")).toContainText("1 manual override");
  await expect(page.locator(".statusbar")).toContainText("Report saved");
  const saved = (await (await request.get(`/api/report-instances/${instance.id}`)).json()) as ReportInstance;
  expect(saved.dataSnapshot).toEqual(original);
  expect(saved.manualOverrides[0]!.cellKey).toContain("period:2025 Q3");
  expect(saved.manualOverrides[0]!.generatedValue).toBe("—");
  await page.reload();
  await expect(cell).toHaveText("18,086,895");
  const printed = page.waitForResponse((item) => item.url().endsWith("/api/render/pdf"), { timeout: 60_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const exportAnyway = page.getByRole("button", { name: /Export anyway/i });
  await expect(exportAnyway).toBeVisible();
  await exportAnyway.click();
  const pdfResponse = await printed;
  expect(pdfResponse.ok()).toBeTruthy();
  const artifact = await download;
  const pdf = await getDocumentProxy(new Uint8Array(await readFile((await artifact.path())!)));
  // One occurrence is the neighboring source quarter; the second is the override.
  expect((await extractText(pdf, { mergePages: true })).text.match(/18,086,895/g)).toHaveLength(2);
  await node.evaluate((element) => (element as HTMLElement).click());
  await page.getByRole("button", { name: "Edit table", exact: true }).click();
  await cell.click();
  await page.getByRole("button", { name: "Clear override / Revert to source" }).click();
  await expect(cell).toHaveText("—");
  await expect(page.locator(".statusbar")).toContainText("0 manual overrides");
  await expect(page.locator(".statusbar")).toContainText("Report saved");
  await page.reload();
  await expect(cell).toHaveText("—");
});
