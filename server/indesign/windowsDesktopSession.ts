import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { DesktopSession, DesktopState } from "./desktopSession.ts";
import type { InDesignTemplateRelease } from "./exportContract.ts";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Revalidate offline input immediately before dispatch. No source queries or repairs. */
export async function verifyDesktopInput(directory: string) {
  const manifest = JSON.parse(await readFile(path.join(directory, "input.json"), "utf8")) as {
    schemaVersion: number; reportId: string; reportRevision: number; reportSha256: string;
    release: InDesignTemplateRelease; jobKey: string; state: string;
    assets: { file: string; sha256: string; bytes: number }[];
  };
  if (manifest.state !== "input-ready" || manifest.schemaVersion !== 1) throw new Error("Desktop input is not ready");
  const identity = { schemaVersion: manifest.schemaVersion, reportId: manifest.reportId,
    reportRevision: manifest.reportRevision, reportSha256: manifest.reportSha256, release: manifest.release };
  if (sha(JSON.stringify(identity)) !== manifest.jobKey || path.basename(directory) !== manifest.jobKey)
    throw new Error("Desktop job identity mismatch");
  const files = [
    { file: "report.json", sha256: manifest.reportSha256 },
    { file: "master.indd", sha256: manifest.release.masterSha256 },
    { file: "build.jsx", sha256: manifest.release.scriptSha256 },
  ];
  for (const asset of manifest.assets) {
    if (!/^Assets\/[a-f0-9]{64}\.[a-z0-9]+$/.test(asset.file) || !/^[a-f0-9]{64}$/.test(asset.sha256))
      throw new Error("Invalid offline asset path");
    files.push(asset);
  }
  for (const file of files) {
    if (sha(await readFile(path.join(directory, file.file))) !== file.sha256)
      throw new Error(`Desktop input changed: ${file.file}`);
  }
  return manifest;
}

type Bridge = (script: string) => Promise<string>;
const run = promisify(execFile);
/** No activation, restart, process kill, or document dismissal. The operator opens InDesign. */
const windowsBridge: Bridge = async script => {
  if (process.platform !== "win32") throw new Error("The desktop export worker requires Windows");
  const encodedScript = Buffer.from(script, "utf8").toString("base64");
  const command = `$ErrorActionPreference='Stop'; $app=[Runtime.InteropServices.Marshal]::GetActiveObject('InDesign.Application.2026'); try { $script=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedScript}')); [Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write($app.DoScript($script,1246973031)) } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }`;
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
    windowsHide: true, maxBuffer: 1024 * 1024,
    // DesktopSession owns the deadline. Killing COM here could leave an indeterminate Adobe job.
  });
  return result.stdout.replace(/^\uFEFF/, "").trim();
};

export class WindowsDesktopSession implements DesktopSession {
  constructor(private readonly bridge: Bridge = windowsBridge) {}
  async inspect(): Promise<DesktopState> {
    const result = await this.bridge(`(function(){ var lines=[encodeURIComponent(app.version)]; for(var i=0;i<app.documents.length;i++){ var d=app.documents[i]; lines.push(encodeURIComponent(d.name)+'\\t'+(d.modified?'1':'0')); } return lines.join('\\n'); })()`);
    const [version, ...documents] = result.split("\n");
    if (!version) throw new Error("InDesign returned no session state");
    return { version: decodeURIComponent(version), openDocuments: documents.filter(Boolean).map(line => {
      const [name, modified] = line.split("\t");
      if (!name || !["0", "1"].includes(modified ?? "")) throw new Error("Invalid InDesign session state");
      return { name: decodeURIComponent(name), modified: modified === "1" };
    }) };
  }
  async execute(directory: string): Promise<void> {
    await verifyDesktopInput(directory);
    const script = path.resolve(directory, "build.jsx");
    // Repeat occupancy check inside Adobe to cover a document opened after inspection.
    const receipt = await this.bridge(`(function(){ if(app.documents.length!==0) throw Error('InDesign session became occupied'); var f=File(${JSON.stringify(script)}); if(!f.exists) throw Error('Pinned build script missing'); app.doScript(f,ScriptLanguage.JAVASCRIPT,[${JSON.stringify(path.resolve(directory))}]); return 'execution-finished'; })()`);
    if (receipt !== "execution-finished") throw new Error("InDesign execution receipt missing; inspect the workstation before recovery");
  }
}
