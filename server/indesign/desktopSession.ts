export interface DesktopState { openDocuments: { name: string; modified: boolean }[]; version: string }
export interface DesktopSession {
  inspect(): Promise<DesktopState>;
  execute(jobDirectory: string): Promise<void>;
}
export interface DesktopJournal {
  /** Workstation-wide lock, retained after an uncertain execution. Never auto-expire. */
  acquireWorkstation(jobKey: string): Promise<boolean>;
  releaseWorkstation(jobKey: string): Promise<void>;
  /** Atomic create-only claim. A prior attempt must never be replayed automatically. */
  claim(jobKey: string): Promise<boolean>;
  record(jobKey: string, state: "running" | "needs-attention" | "execution-finished", detail?: string): Promise<void>;
}

/** Operator-started desktop execution; a completed script still requires independent package QA. */
export async function executeDesktopJob(input: {
  jobKey: string; jobDirectory: string; session: DesktopSession; journal: DesktopJournal;
  timeoutMs: number; operatorStarted: boolean;
}) {
  if (!input.operatorStarted) throw new Error("Desktop exports require an operator-started session.");
  if (!/^[a-f0-9]{64}$/.test(input.jobKey)) throw new Error("Invalid export job key");
  if (!await input.journal.acquireWorkstation(input.jobKey)) throw new Error("The InDesign workstation is busy or requires recovery; no job was started.");
  let dispatched = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await input.session.inspect();
    if (state.openDocuments.length) throw new Error("Close all InDesign documents before starting an export batch. No document was changed.");
    if (!await input.journal.claim(input.jobKey)) throw new Error("This export was already attempted; inspect its journal before recovery.");
    await input.journal.record(input.jobKey, "running", state.version);
    dispatched = true;
    await Promise.race([
      input.session.execute(input.jobDirectory),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Desktop execution timed out; InDesign was left running for operator recovery.")), input.timeoutMs); }),
    ]);
    await input.journal.record(input.jobKey, "execution-finished", "Package validation remains required.");
    finished = true;
  } catch (error) {
    if (dispatched) await input.journal.record(input.jobKey, "needs-attention", String(error));
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (!dispatched || finished) await input.journal.releaseWorkstation(input.jobKey);
  }
}
