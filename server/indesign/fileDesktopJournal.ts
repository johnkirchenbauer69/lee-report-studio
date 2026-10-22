import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DesktopJournal } from "./desktopSession.ts";

function key(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid desktop job key");
  return value;
}
async function exclusive(file: string, value: unknown) {
  let handle;
  try { handle = await open(file, "wx"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  return true;
}

/** Persistent single-workstation journal. Recovery is deliberately an operator task. */
export class FileDesktopJournal implements DesktopJournal {
  private readonly owner = randomUUID();
  constructor(private readonly root: string) {}
  async acquireWorkstation(jobKey: string) {
    key(jobKey); await mkdir(this.root, { recursive: true });
    return exclusive(path.join(this.root, "workstation.lock.json"), { owner: this.owner, jobKey, startedAt: new Date().toISOString(), pid: process.pid });
  }
  async releaseWorkstation(jobKey: string) {
    key(jobKey);
    const file = path.join(this.root, "workstation.lock.json");
    const lock = JSON.parse(await readFile(file, "utf8"));
    if (lock.owner !== this.owner || lock.jobKey !== jobKey) throw new Error("Workstation lock ownership changed; operator recovery required");
    await unlink(file);
  }
  async claim(jobKey: string) {
    const directory = path.join(this.root, "attempts"); await mkdir(directory, { recursive: true });
    return exclusive(path.join(directory, `${key(jobKey)}.json`), { jobKey, owner: this.owner, attemptedAt: new Date().toISOString() });
  }
  async record(jobKey: string, state: "running" | "needs-attention" | "execution-finished", detail?: string) {
    const directory = path.join(this.root, "events", key(jobKey)); await mkdir(directory, { recursive: true });
    await exclusive(path.join(directory, `${Date.now()}-${randomUUID()}.json`), { jobKey, state, detail, recordedAt: new Date().toISOString() });
  }
}
