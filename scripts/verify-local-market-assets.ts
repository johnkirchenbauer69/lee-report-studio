import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { fromBuffer } from "yauzl";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { buildExportPlan } from "../src/report-engine/market-assets/discovery";
import { writeWorkbook } from "../server/market-assets/office";
import { sourceHash } from "../server/market-assets/snapshot";

// Explicit read-only QA of an existing report. The only POSTs create export jobs.
const id = "report-2e6a2cc9-cefa-4a99-a515-d7404e5662cd";
const output = path.join(process.env.TEMP!, "lee-local-integration-20261008", "real-i55");
await mkdir(output, { recursive: true });
const source = JSON.parse(await readFile(`server/data/report-instances/${id}.json`, "utf8"));
const browser = await chromium.launch({ headless: true });
const evidence: Record<string, unknown> = { reportId: id, period: source.dataSnapshot.report.period };
try {
  let archive: string, job: any, preview: any;
  if (process.env.LEE_QA_REUSE_ARCHIVE) {
    archive = process.env.LEE_QA_REUSE_ARCHIVE;
    assert.match(process.env.LEE_QA_REUSE_JOB_ID ?? "", /^export-[a-f0-9-]+$/);
    job = JSON.parse(await readFile(`server/data/market-asset-exports/${process.env.LEE_QA_REUSE_JOB_ID}/job.json`, "utf8"));
  } else {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  await page.goto("http://localhost:3000/");
  await page.locator('a[href="/?marketAssets=1"]').click();
  await page.getByLabel("Saved report", { exact: true }).selectOption(id, { timeout: 120_000 });
  await page.getByRole("button", { name: "Clear markets", exact: true }).click();
  await page.getByLabel("I-55 Corridor", { exact: false }).check();
  await page.getByLabel("PNG resolution").selectOption("standard");
  const previewResponse = page.waitForResponse(r => r.url().endsWith("/api/market-assets/preview") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Preview export", exact: true }).click();
  preview = await (await previewResponse).json();
  await page.screenshot({ path: path.join(output, "preview.png"), fullPage: true });
  const jobResponse = page.waitForResponse(r => r.url().endsWith("/api/market-assets/jobs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Generate ZIP", exact: true }).click();
  job = await (await jobResponse).json();
  for (let i = 0; i < 180 && !["completed", "completed_with_warnings", "failed"].includes(job.state); i++) {
    await page.waitForTimeout(1000);
    job = await (await page.request.get(`http://localhost:3000/api/market-assets/jobs/${job.id}`)).json();
  }
  assert.notEqual(job.state, "failed", JSON.stringify(job));
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /^Download / }).click();
  const download = await downloadPromise;
  archive = path.join(output, download.suggestedFilename());
  await download.saveAs(archive);
  await page.screenshot({ path: path.join(output, "completed.png"), fullPage: true });
  }
  async function unzip(bytes: Buffer): Promise<Map<string, Buffer>> {
    return new Promise((resolve, reject) => fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const files = new Map<string, Buffer>();
      zip.on("error", reject);
      zip.on("entry", e => zip.openReadStream(e, (error, stream) => {
        if (error || !stream) return reject(error);
        const chunks: Buffer[] = [];
        stream.on("error", reject); stream.on("data", c => chunks.push(c));
        stream.on("end", () => { files.set(e.fileName, Buffer.concat(chunks)); zip.readEntry(); });
      }));
      zip.on("end", () => resolve(files)); zip.readEntry();
    }));
  }
  const files = await unzip(await readFile(archive));
  const manifest = JSON.parse([...files].find(([name]) => name.endsWith("/ExportManifest.json"))![1].toString());
  assert.equal(files.size, manifest.files.length + 1);
  for (const declared of manifest.files) {
    const bytes = files.get(declared.filename)!;
    assert.equal(bytes.length, declared.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), declared.checksum);
  }
  const plan = buildExportPlan(source, { reportId: id, markets: ["i55-corridor"], categories: ["charts", "indicators", "transactions", "statistics", "narrative", "section", "properties", "map"], resolution: "standard", transparent: false }, sourceHash(source));
  const offices = [];
  for (const [name, bytes] of files) {
    if (!/\.(xlsx|docx|png)$/.test(name)) continue;
    await writeFile(path.join(output, path.basename(name)), bytes);
    if (name.endsWith(".png") && name.includes("/Charts/")) {
      const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.channels, 4);
      let transparent = 0, interior = 0;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] === 0) {
          transparent++;
          if (x > info.width * .2 && x < info.width * .8 && y > info.height * .2 && y < info.height * .65) interior++;
        }
      }
      assert.ok(interior > info.width * info.height * .1, "Plot must be transparent");
      offices.push({ name, transparentPixels: transparent, transparentPlotPixels: interior });
    }
    if (name.endsWith(".docx")) {
      const parts = await unzip(bytes);
      const xml = parts.get("word/document.xml")!.toString();
      const texts = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
      const narrative = source.narratives.find((n: any) => n.marketId === "i55-corridor");
      assert.equal(narrative.status, "approved");
      assert.equal(texts.slice(2).join("\n"), narrative.text.replace(/\r\n|\r/g, "\n"));
      assert.ok(texts[0].includes("I-55")); assert.equal(texts[1], "Q3 2026");
      evidence.narrative = { status: narrative.status, characters: narrative.text.length, exactTextAndParagraphs: true, editableNativeText: true, sourceSha256: createHash("sha256").update(narrative.text).digest("hex") };
    }
    if (name.endsWith(".xlsx")) {
      const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as any);
      const asset = plan.assets.find(a => a.path === name)!;
      assert.ok(asset, name);
      const expected = new ExcelJS.Workbook(); await expected.xlsx.load(await writeWorkbook(asset, plan) as any);
      assert.equal(book.worksheets.length, expected.worksheets.length);
      for (const sheet of expected.worksheets) sheet.eachRow(row => row.eachCell(cell => {
        const actual = book.getWorksheet(sheet.name)!.getCell(cell.address);
        assert.deepEqual(actual.value, cell.value); assert.equal(actual.numFmt, cell.numFmt);
      }));
      if (name.includes("Property Highlights")) {
        assert.equal(book.worksheets.length, 1);
        const labels: unknown[] = [];
        book.worksheets[0].eachRow(row => row.eachCell(cell => labels.push(cell.value)));
        for (const label of ["Top Availabilities", "Deliveries", "Under Construction"]) assert.ok(labels.includes(label), label);
      }
      offices.push({ name, sheets: book.worksheets.map(s => ({ name: s.name, rows: s.rowCount, tables: Object.keys(s.tables).length, print: s.pageSetup })) });
    }
  }
  Object.assign(evidence, { archive, job, preview, manifest, files: [...files.keys()], structuralReview: offices });
  await writeFile(path.join(output, "verification.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ archive, jobId: job.id, state: job.state, files: files.size, narrative: evidence.narrative, warnings: job.warnings }, null, 2));
} finally { await browser.close(); }
