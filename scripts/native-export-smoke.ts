import { readFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import { FileSystemAssetStore } from "../server/assets/assetStore.ts";
import { freezePresentation } from "../server/market-assets/snapshot.ts";
import { captureNativeLayout } from "../server/indesign/nativeLayout.ts";
import { prepareDesktopInput } from "../server/indesign/desktopInput.ts";
import { WindowsDesktopSession } from "../server/indesign/windowsDesktopSession.ts";
import { executeDesktopJob } from "../server/indesign/desktopSession.ts";
import { FileDesktopJournal } from "../server/indesign/fileDesktopJournal.ts";
import os from "node:os";
const [reportPath, outputRoot, first = "0", count = "2"] =
  process.argv.slice(2);
if (!reportPath || !outputRoot)
  throw Error("Expected saved report path and new output root");
await mkdir(outputRoot, { recursive: false });
const report = JSON.parse(await readFile(reportPath, "utf8"));
report.pages = report.pages.slice(Number(first), Number(first) + Number(count));
const store = new FileSystemAssetStore("server/data");
const job = await freezePresentation(report, report.pages, store);
const app = express();
app.get("/api/render-jobs/:id", (_req, res) => res.json(job));
app.use(express.static(path.resolve("dist")));
const server = app.listen(0, "127.0.0.1");
try {
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No address");
  await captureNativeLayout(
    job,
    `http://127.0.0.1:${address.port}/?printJob=native`,
    outputRoot,
    console.log,
  );
  const derivedFiles = [];
  for (const folder of ["Links", "Document fonts"])
    for (const name of await readdir(path.join(outputRoot, folder)))
      derivedFiles.push({
        file: `${folder}/${name}`,
        bytes: await readFile(path.join(outputRoot, folder, name)),
      });
  const masterFile = path.join(outputRoot, "layout.json"),
    scriptFile = path.resolve("server/indesign/build-native.jsx");
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const release = {
    familyId: report.templateId,
    templateVersion: report.templateVersion,
    templateChecksum: report.templateChecksum,
    masterFormat: "json" as const,
    masterSha256: hash(await readFile(masterFile)),
    scriptSha256: hash(await readFile(scriptFile)),
    expectedPages: report.pages.length,
  };
  const input = await prepareDesktopInput({
    report,
    release,
    masterFile,
    scriptFile,
    derivedFiles,
    capturedAssetsDirectory: path.resolve("server/data/report-instance-assets"),
    outputRoot: path.join(outputRoot, "prepared"),
  });
  console.log("Input ready", input.directory);
  if (process.env.LEE_NATIVE_PREPARE_ONLY !== "1") {
    await executeDesktopJob({
      jobKey: input.manifest.jobKey,
      jobDirectory: input.directory,
      journal: new FileDesktopJournal(
        path.join(
          os.homedir(),
          "AppData",
          "Local",
          "Lee Report Studio",
          "native-export-journal",
        ),
      ),
      session: WindowsDesktopSession.operatorStarted(),
      timeoutMs: 900000,
      operatorStarted: true,
    });
    console.log(
      await readFile(
        path.join(input.directory, "native-validation.json"),
        "utf8",
      ),
    );
  }
} finally {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
