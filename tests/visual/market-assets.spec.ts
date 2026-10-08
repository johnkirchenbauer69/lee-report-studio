import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import sharp from "sharp";
import { marketAssetFixture } from "../support/marketAssetFixture";
import {
  CATEGORIES,
  type ExportJob,
} from "../../src/report-engine/market-assets/contracts";
import {
  buildExportPlan,
  elementBounds,
} from "../../src/report-engine/market-assets/discovery";
import { FileSystemAssetStore } from "../../server/assets/assetStore";
import { freezePresentation } from "../../server/market-assets/snapshot";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { sourceHash } from "../../server/market-assets/snapshot";
import { validateZip } from "../../server/market-assets/service";

test.use({ launchOptions: { args: ["--font-render-hinting=none"] } });
const evidence = "docs/evidence/market-assets";
test("transparent chart export preserves artwork and removes page background", async ({
  request,
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await marketAssetFixture();
  const response = await request.post("/api/report-instances", {
    data: { ...fixture, id: "report-market-assets-transparent-qa" },
  });
  expect(response.status()).toBe(201);
  const saved = await response.json();
  const body = {
    reportId: saved.id,
    markets: ["i55-corridor"],
    categories: ["charts"],
    resolution: "standard",
    transparent: true,
  };
  const preview = await (
    await request.post("/api/market-assets/preview", { data: body })
  ).json();
  let job: ExportJob = await (
    await request.post("/api/market-assets/jobs", {
      data: {
        ...body,
        revision: preview.revision,
        snapshotHash: preview.snapshotHash,
      },
    })
  ).json();
  for (
    let i = 0;
    i < 60 &&
    !["completed", "failed", "completed_with_warnings"].includes(job.state);
    i++
  ) {
    await page.waitForTimeout(1000);
    job = await (await request.get(`/api/market-assets/jobs/${job.id}`)).json();
  }
  expect(job.state).toBe("completed");
  const bytes = await (
    await request.get(`/api/market-assets/jobs/${job.id}/download`)
  ).body();
  const { fromBuffer } = await import("yauzl");
  const pngs = await new Promise<Buffer[]>((resolve, reject) =>
    fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const images: Buffer[] = [];
      zip.on("error", reject);
      zip.on("entry", (entry) =>
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks: Buffer[] = [];
          stream.on("error", reject);
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => {
            if (entry.fileName.endsWith(".png"))
              images.push(Buffer.concat(chunks));
            zip.readEntry();
          });
        }),
      );
      zip.on("end", () => resolve(images));
      zip.readEntry();
    }),
  );
  expect(pngs).toHaveLength(4);
  for (const png of pngs) {
    expect((await sharp(png).metadata()).hasAlpha).toBe(true);
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[info.channels - 1]).toBe(0);
    expect((await sharp(png).stats()).channels[3].max).toBe(255);
  }
});
test("saved snapshot selection and all export formats preserve source content", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const fixture = await marketAssetFixture();
  const created = await request.post("/api/report-instances", {
    data: fixture,
  });
  expect(created.status()).toBe(201);
  const saved = await created.json();
  const originalHash = sourceHash(saved);
  await page.goto("/?marketAssets=1");
  await expect(
    page.getByRole("heading", { name: "Market Asset Export", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Saved report", { exact: true })
    .selectOption(fixture.id);
  await expect(
    page.getByRole("checkbox", { name: /I-55 Corridor/ }),
  ).toBeVisible();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/workspace.png`, fullPage: true });
  await page
    .getByRole("button", { name: "Clear markets", exact: true })
    .click();
  await page.getByLabel("I-55 Corridor", { exact: false }).check();
  await page
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Generate ZIP", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
  await page.screenshot({
    path: `${evidence}/preview-single.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Generate ZIP", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Download I-55/ })).toBeVisible({
    timeout: 120_000,
  });
  await page.screenshot({ path: `${evidence}/completed.png`, fullPage: true });
  const downloadLink = await page
    .getByRole("link", { name: /^Download I-55/ })
    .getAttribute("href");
  const id = downloadLink!.split("/").at(-2)!;
  const result = await request.get(`/api/market-assets/jobs/${id}`),
    job: ExportJob = await result.json();
  expect(job.manifest?.omissions).toEqual([]);
  expect(new Set(job.manifest?.files.map((f) => f.category))).toEqual(
    new Set(Object.keys(CATEGORIES)),
  );
  const archive = await request.get(downloadLink!);
  expect(archive.status()).toBe(200);
  const file = `${evidence}/I-55-all-assets-synthetic.zip`;
  await writeFile(file, await archive.body());
  await validateZip(
    file,
    job.manifest!,
    `${job.manifest!.files[0].filename.split("/")[0]}/ExportManifest.json`,
  );
  expect(
    sourceHash(
      await (await request.get(`/api/report-instances/${fixture.id}`)).json(),
    ),
  ).toBe(originalHash);
  await page
    .getByRole("button", { name: "Clear markets", exact: true })
    .click();
  for (const market of ["I-55 Corridor", "O'Hare", "I-80/Joliet Area"])
    await page.getByLabel(market, { exact: false }).check();
  await page
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(page.getByText(/3 markets · 8 categories/)).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({
    path: `${evidence}/preview-multiple.png`,
    fullPage: true,
  });
});

test("single, multiple and all-market packages have complete inventories and bounded workloads", async ({
  page,
  request,
}) => {
  test.setTimeout(900_000);
  await mkdir(evidence, { recursive: true });
  const health = await (await request.get("/api/health")).json();
  expect(health.testMode).toBe(true);
  const fixtureStore = new FileSystemAssetStore(health.dataRoot);
  const saved = await (
    await request.get("/api/report-instances/report-market-assets-synthetic-qa")
  ).json();
  const allMarkets = (
    await (await request.get(`/api/market-assets/reports/${saved.id}`)).json()
  ).markets.map((m: { id: string }) => m.id);
  const results: unknown[] = [];
  for (const selection of [
    {
      title: "I-55-charts-only-synthetic",
      markets: ["i55-corridor"],
      categories: ["charts"],
    },
    {
      title: "multiple-markets-synthetic",
      markets: ["i55-corridor", "ohare", "i80-joliet"],
      categories: Object.keys(CATEGORIES),
    },
    {
      title: "all-19-markets-synthetic",
      markets: allMarkets,
      categories: Object.keys(CATEGORIES),
    },
  ]) {
    const start = Date.now();
    const body = {
      reportId: saved.id,
      markets: selection.markets,
      categories: selection.categories,
      resolution: "high",
      transparent: false,
    };
    const previewResponse = await request.post("/api/market-assets/preview", {
      data: body,
      timeout: 90_000,
    });
    expect(previewResponse.status()).toBe(200);
    const preview = await previewResponse.json();
    const response = await request.post("/api/market-assets/jobs", {
      data: {
        ...body,
        revision: preview.revision,
        snapshotHash: preview.snapshotHash,
      },
      timeout: 90_000,
    });
    expect(response.status()).toBe(202);
    let job: ExportJob = await response.json();
    for (
      let i = 0;
      i < 700 &&
      !["completed", "completed_with_warnings", "failed"].includes(job.state);
      i++
    ) {
      await page.waitForTimeout(1000);
      job = await (
        await request.get(`/api/market-assets/jobs/${job.id}`)
      ).json();
    }
    expect(["completed", "completed_with_warnings"]).toContain(job.state);
    expect(job.manifest!.omissions).toEqual([]);
    expect(job.manifest!.files.length).toBe(
      selection.categories.length === 1 ? 4 : selection.markets.length * 17,
    );
    const download = await request.get(
      `/api/market-assets/jobs/${job.id}/download`,
    );
    expect(download.status()).toBe(200);
    const bytes = await download.body(),
      file = `${evidence}/${selection.title}.zip`;
    await writeFile(file, bytes);
    await writeFile(
      `${evidence}/${selection.title}-manifest.json`,
      JSON.stringify(job.manifest, null, 2),
    );
    await validateZip(
      file,
      job.manifest!,
      preview.root + "/ExportManifest.json",
    );
    results.push({
      selection: selection.title,
      markets: selection.markets.length,
      files: job.manifest!.files.length,
      seconds: (Date.now() - start) / 1000,
      bytes: bytes.length,
      warnings: job.warnings.length,
    });
    await writeFile(
      `${evidence}/benchmark.json`,
      JSON.stringify(results, null, 2),
    );
  }
  expect(
    sourceHash(
      await (await request.get(`/api/report-instances/${saved.id}`)).json(),
    ),
  ).toBe(sourceHash(saved));
});

test("fragment PNG matches the saved page rendering and section PDF uses Chromium", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  await mkdir(evidence, { recursive: true });
  const health = await (await request.get("/api/health")).json();
  expect(health.testMode).toBe(true);
  const fixtureStore = new FileSystemAssetStore(health.dataRoot);
  const saved = await (
    await request.get("/api/report-instances/report-market-assets-synthetic-qa")
  ).json();
  const body = {
    reportId: saved.id,
    markets: ["i55-corridor"],
    categories: ["charts", "section"],
    resolution: "standard",
    transparent: false,
  };
  const preview = await (
    await request.post("/api/market-assets/preview", { data: body })
  ).json();
  const job = await (
    await request.post("/api/market-assets/jobs", {
      data: {
        ...body,
        revision: preview.revision,
        snapshotHash: preview.snapshotHash,
      },
    })
  ).json();
  let result: ExportJob = job;
  for (
    let i = 0;
    i < 100 &&
    !["completed", "completed_with_warnings", "failed"].includes(result.state);
    i++
  ) {
    await page.waitForTimeout(1000);
    result = await (
      await request.get(`/api/market-assets/jobs/${job.id}`)
    ).json();
  }
  expect(result.state).toBe("completed");
  expect(result.manifest!.files.filter((f) => f.format === "png")).toHaveLength(
    4,
  );
  const archive = await request.get(
    `/api/market-assets/jobs/${job.id}/download`,
  );
  await writeFile(
    `${evidence}/I-55-charts-and-section-synthetic.zip`,
    await archive.body(),
  );
  const { fromBuffer } = await import("yauzl");
  const archiveBytes = await archive.body();
  const entries = await new Promise<Record<string, Buffer>>((resolve, reject) =>
    fromBuffer(Buffer.from(archiveBytes), { lazyEntries: true }, (e, z) => {
      if (e || !z) return reject(e);
      const files: Record<string, Buffer> = {};
      z.on("entry", (e) =>
        z.openReadStream(e, (err, s) => {
          if (err || !s) return reject(err);
          const chunks: Buffer[] = [];
          s.on("data", (c) => chunks.push(c));
          s.on("end", () => {
            files[e.fileName] = Buffer.concat(chunks);
            z.readEntry();
          });
        }),
      );
      z.on("end", () => resolve(files));
      z.on("error", reject);
      z.readEntry();
    }),
  );
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith(".png")) {
      expect((await sharp(bytes).metadata()).width).toBe(1200);
      const asset = buildExportPlan(
        saved,
        { ...body, categories: ["charts", "section"], resolution: "standard" },
        sourceHash(saved),
      ).assets.find((a) => a.path === name)!;
      const bounds = asset.elements!.map(elementBounds),
        x = Math.min(...bounds.map((b) => b.x)) - 4,
        y = Math.min(...bounds.map((b) => b.y)) - 4;
      const width = Math.max(...bounds.map((b) => b.x + b.width)) - x + 4,
        height = Math.max(...bounds.map((b) => b.y + b.height)) - y + 4;
      const frozen = await freezePresentation(
        saved,
        [asset.page!],
        fixtureStore,
      );
      const context = await browser.newContext({
        deviceScaleFactor: 1200 / width,
        viewport: { width: 900, height: 1120 },
      });
      const reference = await context.newPage();
      await reference.route("**/api/render-jobs/parity", (route) =>
        route.fulfill({ json: frozen }),
      );
      await reference.goto("/?printJob=parity");
      await reference.locator('[data-render-ready="true"]').waitFor();
      await reference.evaluate(() => document.fonts.ready);
      const origin = await reference.locator(".print-page").boundingBox();
      const expected = PNG.sync.read(
          await reference.screenshot({
            clip: { x: origin!.x + x, y: origin!.y + y, width, height },
          }),
        ),
        actual = PNG.sync.read(bytes);
      expect(actual.width).toBe(expected.width);
      expect(actual.height).toBe(expected.height);
      expect(
        pixelmatch(
          actual.data,
          expected.data,
          undefined,
          actual.width,
          actual.height,
          { threshold: 0.1 },
        ) /
          (actual.width * actual.height),
      ).toBeLessThan(0.003);
      await context.close();
    }
    if (name.endsWith(".pdf")) {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      expect(pdf.getPageCount()).toBe(2);
      expect(pdf.getProducer()).toBe("LEE Report Studio Chromium renderer");
      const text = (
        await extractText(await getDocumentProxy(new Uint8Array(bytes)), {
          mergePages: true,
        })
      ).text;
      expect(text).toContain("I-55");
      expect(text).toContain("synthetic export QA narrative");
      await writeFile(`${evidence}/I-55-section-synthetic.pdf`, bytes);
    }
  }
});
