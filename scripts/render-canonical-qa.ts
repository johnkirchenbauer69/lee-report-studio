/** Supervisor enforces a wall-clock deadline even if the renderer event loop stalls. */
import { fork, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
const timeoutMs = Number(process.env.LEE_QA_TIMEOUT_MS ?? 300_000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000) throw new Error("LEE_QA_TIMEOUT_MS must be 100..600000");
const started = Date.now();
const child = fork(fileURLToPath(new URL("./canonicalQaWorker.ts", import.meta.url)), process.argv.slice(2), { stdio: ["ignore", "inherit", "inherit", "ipc"] });
let failed = false;
let forceTimer: ReturnType<typeof setTimeout> | undefined;
const cancel = (reason: string) => {
  if (failed) return;
  failed = true;
  console.error(JSON.stringify({ status: "failure", reason, elapsedMs: Date.now() - started, pid: child.pid }));
  if (child.connected) child.send("abort");
  forceTimer = setTimeout(() => {
    // Exact child PID is owned by this supervisor; never target other browsers/apps.
    if (process.platform === "win32") execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], error => { if (error) console.error(error.message); });
    else child.kill("SIGKILL");
  }, 10_000);
};
const timer = setTimeout(() => cancel("Global QA deadline exceeded"), timeoutMs);
process.on("SIGINT", () => cancel("Interrupted"));
process.on("SIGTERM", () => cancel("Terminated"));
child.on("error", error => cancel(error.message));
child.on("exit", (code, signal) => {
  clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer);
  process.exitCode = failed || code !== 0 ? 1 : 0;
  console.log(JSON.stringify({ status: process.exitCode ? "failure" : "success", code, signal, elapsedMs: Date.now() - started }));
});
