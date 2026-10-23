import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { freezePresentation } from "../server/market-assets/snapshot.ts";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
const [source, output] = process.argv.slice(2);
if (!source || !output) throw Error("Supply frozen report and new output directory");
await mkdir(output, { recursive: false });
const report = JSON.parse(await readFile(source, "utf8"));
const job = await freezePresentation(report, report.pages, new FileSystemAssetStore("server/data"));
const app = express();
app.get("/api/render-jobs/:id", (_req, res) => res.json(job));
app.use(express.static(path.resolve("dist")));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("No address");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("requestfailed", r => errors.push(`${r.url().slice(0, 80)}: ${r.failure()?.errorText}`));
  page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${address.port}/?printJob=frozen`);
  await page.locator('[data-render-ready="true"]').waitFor({ timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator("section.print-page").count() !== 44) throw Error("Expected 44 pages");
  const images = await page.locator("section.print-page img").evaluateAll(elements => elements.filter(e => !(e as HTMLImageElement).complete || !(e as HTMLImageElement).naturalWidth).length);
  if (images) throw Error(`${images} broken images`);
  for (const index of [0, 2, 3, 4, 5, 22, 23, 28, 29, 42, 43])
    await page.locator("section.print-page").nth(index).screenshot({ path: path.join(output, `page-${index + 1}.png`) });
  const pdf = await page.pdf({ path: path.join(output, "Geographic-v1.2.1.pdf"), format: "Letter", printBackground: true });
  if ((await PDFDocument.load(pdf)).getPageCount() !== 44 || errors.length) throw Error(JSON.stringify(errors));
  await writeFile(path.join(output, "validation.json"), JSON.stringify({ pages: 44, brokenImages: images, errors, source }, null, 2));
  console.log("44-page frozen browser PDF and screenshots validated", output);
} finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
