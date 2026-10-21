/** Replay exact captured print inputs without generation or persisted-data writes. */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
import { ChromiumPdfRenderer } from "../server/renderers/chromiumPdfRenderer.ts";
import { freezePresentation } from "../server/market-assets/snapshot.ts";
const [inputDirectory, outputDirectory, dataRoot = "server/data", mode] =
  process.argv.slice(2);
if (!inputDirectory || !outputDirectory)
  throw Error("Expected captured job directory and NEW output directory");
const app = express(),
  store = new FileSystemAssetStore(dataRoot);
const assets = await store.list();
let currentJob: unknown;
app.get("/api/assets", (_req, res) => res.json({ assets }));
app.get("/api/assets/:id/content", (req, res) => {
  const asset = assets.find((a) => a.id === req.params.id);
  if (!asset) {
    res.sendStatus(404);
    return;
  }
  res.sendFile(path.resolve(store.resolve(asset)));
});
app.get("/api/render-jobs/:id", (_req, res) => res.json(currentJob));
app.use(express.static(path.resolve("dist")));
const server = app.listen(0, "127.0.0.1");
try {
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No QA address");
  await mkdir(outputDirectory, { recursive: false });
  for (const family of ["classic", "geographic"]) {
    const name = `industrial-market-${family}`;
    if (mode === "reports") {
      const reports = await Promise.all(
        (await readdir(inputDirectory))
          .filter((file) => file.endsWith(".json"))
          .map(async (file) =>
            JSON.parse(await readFile(path.join(inputDirectory, file), "utf8")),
          ),
      );
      const report = reports.find((report) => report.templateId === name);
      if (!report) throw Error("Missing frozen report " + name);
      currentJob = await freezePresentation(report, report.pages, store);
    } else
      currentJob = JSON.parse(
        await readFile(path.join(inputDirectory, name + ".json"), "utf8"),
      );
    const bytes = await new ChromiumPdfRenderer().render({
      url: `http://127.0.0.1:${address.port}/?printJob=qa`,
      title: `${family} exact-input QA`,
      onProgress: (stage, detail) =>
        console.log(JSON.stringify({ family, stage, detail })),
    });
    await writeFile(path.join(outputDirectory, name + ".pdf"), bytes, {
      flag: "wx",
    });
  }
} finally {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
