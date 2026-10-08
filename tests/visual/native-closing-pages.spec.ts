import { expect, test } from "@playwright/test";
import { PDFDocument, PDFName, PDFDict, PDFString } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { sampleData } from "../../src/data/sampleData";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport";
import { prepareTemplateForReport } from "../../src/report-engine/generation/prepareTemplate";
import { expandTemplatePages } from "../../src/report-engine/generation/repeaters";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";

test("closing-page text, hyperlinks, images and page fit survive browser PDF export", async ({ page }) => {
  const template = { ...sampleTemplate, pages: sampleTemplate.pages.slice(-4) };
  await page.route("**/api/**", route => route.fulfill({ json: { template, data: sampleData, title: "Closing pages" } }));
  await page.goto("/?printJob=fixture");
  await expect(page.locator('[data-render-ready="true"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".closing-contact a")).toHaveCount(45);
  expect(await page.locator(".closing-content").evaluateAll(nodes => nodes.every(node => node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1))).toBe(true);
  expect(await page.locator(".closing-content img").evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const bytes = await page.pdf({ format: "Letter", printBackground: true });
  const text = (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text;
  for (const term of ["Metropolitan Areas Monitored", "Direct Net Absorption", "Dustin Albers", "bpappas@lee-associates.com", "WHO WE ARE", "1979 - Irvine"]) expect(text).toContain(term);
  const pdf = await PDFDocument.load(bytes);
  const annotations = pdf.getPages()[2].node.Annots();
  const links = annotations?.asArray().flatMap(ref => {
    const action = pdf.context.lookup(ref, PDFDict).lookupMaybe(PDFName.of("A"), PDFDict);
    const uri = action?.lookupMaybe(PDFName.of("URI"), PDFString);
    return uri?.decodeText().startsWith("mailto:") ? [uri.decodeText()] : [];
  });
  expect(links).toHaveLength(45);
});

test("all 19 indicator tables share typography and a dynamically selected current quarter", async ({ page }) => {
  const source = structuredClone(q2SampleReport);
  source.report.period = "2026 Q4";
  source.historicalPeriods.forEach((period, i) => { period.period = ["2026 Q4", "2026 Q3", "2026 Q2", "2026 Q1", "2025 Q4"][i]; });
  source.submarketDetails.forEach(detail => { detail.historicalPeriods = structuredClone(source.historicalPeriods); });
  const data = buildPresentationModel(source);
  const template = prepareTemplateForReport(sampleTemplate, source, data, "sample");
  template.pages = expandTemplatePages(template, data);
  await page.route("**/api/**", route => route.fulfill({ json: { template, data, title: "Indicators" } }));
  await page.goto("/?printJob=fixture");
  await expect(page.locator(".table-indicators")).toHaveCount(19);
  const styles = await page.locator(".table-indicators").evaluateAll(tables => tables.map(table => ({
    size: getComputedStyle(table).fontSize,
    weights: Array.from(table.querySelectorAll("tbody tr:first-child td")).map(cell => getComputedStyle(cell).fontWeight),
    header: table.querySelectorAll("th")[1].textContent,
    border: getComputedStyle(table.querySelector("td")!).borderBottomWidth,
  })));
  expect(styles.every(style => JSON.stringify(style) === JSON.stringify(styles[0]))).toBe(true);
  expect(styles[0]).toEqual({ size: "9px", weights: ["700", "700", "400", "400", "400", "400"], header: "Q4 2026", border: "1px" });
  expect(await page.locator('.metric-direction-indicator[data-direction="up"]').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).color === "rgb(138, 148, 30)"))).toBe(true);
  expect(await page.locator('.metric-direction-indicator[data-direction="down"]').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).color === "rgb(205, 20, 66)"))).toBe(true);
});

test("long contact records wrap predictably, and excessive additions report overflow", async ({ page }) => {
  const template = structuredClone(sampleTemplate);
  const content = template.pages[8].elements.find(e => e.type === "text" && e.closingContent);
  if (!content || content.type !== "text" || content.closingContent?.kind !== "contacts") throw new Error("Missing directory");
  const contacts = content.closingContent.contacts;
  contacts[0].name = "A very long contact name with multiple parts";
  contacts[0].title = "Senior Vice President of Regional Industrial Property Advisory";
  contacts[0].email = "a.very.long.contact.address@example.com";
  template.pages = [template.pages[8]];
  await page.route("**/api/**", route => route.fulfill({ json: { template, data: sampleData, title: "Contacts" } }));
  await page.goto("/?printJob=fixture");
  const first = page.locator(".closing-contact").first();
  expect(await first.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  contacts.push(...Array.from({ length: 60 }, (_, index) => ({ ...contacts[0], id: `extra-${index}`, displayOrder: 100 + index })));
  await page.reload();
  await expect(page.locator('[data-closing-overflow="true"]')).toHaveCount(1);
});

test("contact edits use the Inspector and survive Save and reopening the template", async ({ page }) => {
  const template = { ...structuredClone(sampleTemplate), pages: [structuredClone(sampleTemplate.pages[8])] };
  let record = { id: template.id, name: template.name, version: template.version, status: "draft", templateType: "industrial-market-report", checksum: "fixture", revision: 1,
    pageDefinitionCount: 1, createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", template, assetReferences: [], managedFontReferences: [] };
  let saves = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(record.revision);
      record = { ...record, template: body.template, revision: record.revision + 1 }; saves++;
      await route.fulfill({ json: record });
    } else if (path === "/api/templates") await route.fulfill({ json: { templates: [record] } });
    else if (path.endsWith("/versions")) await route.fulfill({ json: { versions: [record] } });
    else if (path.includes("/versions/")) await route.fulfill({ json: record });
    else if (path === "/api/assets") await route.fulfill({ json: { assets: [] } });
    else await route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByTestId("contacts-content").click({ position: { x: 80, y: 15 } });
  const editor = page.locator(".closing-editor");
  await editor.getByRole("textbox", { name: "Email", exact: true }).first().fill("edited@example.com");
  await editor.getByRole("button", { name: "Apply content changes" }).click();
  await expect(page.locator('.closing-contact a[href="mailto:edited@example.com"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => saves).toBe(1);
  await page.reload();
  await expect(page.locator('.closing-contact a[href="mailto:edited@example.com"]')).toHaveCount(1);
});

test("Top Sales and Top Leases wrap long names within the approved column grid", async ({ page }) => {
  const template = { ...sampleTemplate, pages: [sampleTemplate.pages[2]] };
  const data = structuredClone(sampleData);
  data.topSaleRows[0].party = "Ares Commercial Real Estate Management";
  data.topLeaseRows[0].party = "A long industrial tenant company name with regional operations";
  await page.route("**/api/**", route => route.fulfill({ json: { template, data, title: "Transactions" } }));
  await page.goto("/?printJob=fixture");
  await expect(page.locator(".table-transactions")).toHaveCount(2);
  const bounds = await page.locator(".table-transactions td").evaluateAll(cells => cells.map(cell => {
    const range = document.createRange(); range.selectNodeContents(cell);
    const text = range.getBoundingClientRect(), box = cell.getBoundingClientRect();
    return { inside: text.left >= box.left && text.right <= box.right + 1 && text.top >= box.top && text.bottom <= box.bottom + 1 };
  }));
  expect(bounds.every(cell => cell.inside)).toBe(true);
  expect(await page.locator(".table-transactions").evaluateAll(tables => tables.every(table => table.getBoundingClientRect().bottom <= table.closest(".canvas-element")!.getBoundingClientRect().bottom + 1))).toBe(true);
  await expect(page.getByText("Ares Commercial Real Estate Management", { exact: true })).toBeVisible();
});
