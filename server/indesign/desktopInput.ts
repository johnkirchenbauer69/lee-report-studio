import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import { freezeInDesignExport, type InDesignTemplateRelease } from "./exportContract.ts";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/svg+xml": ".svg",
  "image/webp": ".webp", "font/ttf": ".ttf", "font/otf": ".otf", "application/x-font-ttf": ".ttf",
  "application/x-font-opentype": ".otf", "font/woff": ".woff", "font/woff2": ".woff2" };

/** Adobe-independent input preparation. A ready input is NOT a validated Marketing package. */
export async function prepareDesktopInput(input: {
  report: ReportInstance; release: InDesignTemplateRelease; masterFile: string; scriptFile: string;
  capturedAssetsDirectory: string; outputRoot: string;
}) {
  const frozen = freezeInDesignExport(input.report, input.release);
  const [master, script] = await Promise.all([readFile(input.masterFile), readFile(input.scriptFile)]);
  if (digest(master) !== input.release.masterSha256 || digest(script) !== input.release.scriptSha256)
    throw new Error("The configured InDesign master or script does not match its release hash.");
  const assets = frozen.snapshot.presentationAssets ?? [];
  const available = new Set(assets.map(asset => asset.source));
  for (const page of frozen.snapshot.pages.filter(page => !page.hidden)) {
    for (const element of page.elements.filter(element => !element.hidden)) {
      if (element.type === "image" && element.src && !available.has(element.src))
        throw new Error(`Image was not captured with this report: ${element.id}`);
    }
  }
  for (const font of frozen.snapshot.fontReferences)
    if (!assets.some(asset => asset.checksum === font.checksum)) throw new Error(`Font bytes were not captured: ${font.family}`);
  const files: { source: string; file: string; sha256: string; bytes: number; mimeType: string }[] = [];
  // Verify the entire population before exposing a ready manifest. Never fetch current source data.
  for (const asset of assets) {
    if (!/^[a-f0-9]{64}$/.test(asset.storageKey) || asset.storageKey !== asset.checksum)
      throw new Error("Invalid captured asset key");
    const bytes = await readFile(path.join(input.capturedAssetsDirectory, asset.storageKey));
    if (digest(bytes) !== asset.checksum) throw new Error("Captured InDesign input asset checksum mismatch");
    const extension = extensions[asset.mimeType];
    if (!extension) throw new Error(`Unsupported InDesign input asset type: ${asset.mimeType}`);
    files.push({ source: asset.source, file: `Assets/${asset.checksum}${extension}`, sha256: asset.checksum, bytes: bytes.length, mimeType: asset.mimeType });
  }
  const directory = path.join(input.outputRoot, frozen.jobKey);
  await mkdir(input.outputRoot, { recursive: true });
  await mkdir(directory); // An existing or interrupted job is never overwritten/replayed.
  await mkdir(path.join(directory, "Assets"));
  await writeFile(path.join(directory, "master.indd"), master, { flag: "wx" });
  await writeFile(path.join(directory, "build.jsx"), script, { flag: "wx" });
  await writeFile(path.join(directory, "report.json"), JSON.stringify(frozen.snapshot), { flag: "wx" });
  const copied = new Set<string>();
  for (const asset of files) {
    if (copied.has(asset.file)) continue;
    const bytes = await readFile(path.join(input.capturedAssetsDirectory, asset.sha256));
    if (digest(bytes) !== asset.sha256) throw new Error("Captured bytes changed during preparation");
    const destination = path.join(directory, asset.file);
    await writeFile(destination, bytes, { flag: "wx" });
    if (digest(await readFile(destination)) !== asset.sha256) throw new Error("InDesign input copy failed verification");
    copied.add(asset.file);
  }
  const manifest = { ...frozen.manifest, jobKey: frozen.jobKey, state: "input-ready" as const, assets: files,
    requiredValidation: ["native text and tables", "links", "font substitutions", "overset frames and cells", "save/reopen", "relocation", "QA PDF", "IDML import before inclusion"] };
  await writeFile(path.join(directory, "input.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  return { directory, manifest };
}
