import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { marketAssetFixture } from "../../tests/support/marketAssetFixture";
import { prepareDesktopInput } from "./desktopInput";
import { verifyDesktopInput } from "./windowsDesktopSession";
const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
it("copies only pinned bytes without source queries and refuses a duplicate attempt or modified master", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lee-input-"));
  try {
    const report = await marketAssetFixture(); report.pages = [{ ...report.pages[0]!, elements: [] }]; report.fontReferences = [];
    report.presentationAssets = [{ source: "/api/assets/photo/content", checksum: sha("photo"), storageKey: sha("photo"), mimeType: "image/jpeg" }];
    const captured = path.join(root, "captured"); await mkdir(captured); await writeFile(path.join(captured, sha("photo")), "photo");
    const masterFile = path.join(root, "master.indd"), scriptFile = path.join(root, "build.jsx");
    await writeFile(masterFile, "master"); await writeFile(scriptFile, "script");
    const release = { familyId: report.templateId, templateVersion: report.templateVersion, templateChecksum: report.templateChecksum,
      masterSha256: sha("master"), scriptSha256: sha("script"), expectedPages: 1 };
    const options = { report, release, masterFile, scriptFile, capturedAssetsDirectory: captured, outputRoot: path.join(root, "jobs") };
    const before = JSON.stringify(report);
    const result = await prepareDesktopInput(options);
    expect((await verifyDesktopInput(result.directory)).jobKey).toBe(result.manifest.jobKey);
    expect(JSON.stringify(report)).toBe(before);
    expect(await readFile(path.join(result.directory, result.manifest.assets[0]!.file), "utf8")).toBe("photo");
    expect(JSON.parse(await readFile(path.join(result.directory, "report.json"), "utf8"))).toEqual(report);
    await expect(prepareDesktopInput(options)).rejects.toMatchObject({ code: "EEXIST" });
    await writeFile(path.join(result.directory, "build.jsx"), "tampered");
    await expect(verifyDesktopInput(result.directory)).rejects.toThrow("Desktop input changed: build.jsx");
    await writeFile(masterFile, "changed");
    await expect(prepareDesktopInput(options)).rejects.toThrow("release hash");
  } finally { await rm(root, { recursive: true, force: true }); }
});
