import { expect, it, vi } from "vitest";
import { executeDesktopJob } from "./desktopSession";

const setup = () => ({ jobKey: "a".repeat(64), jobDirectory: "job", timeoutMs: 20, operatorStarted: true,
  session: { inspect: vi.fn(async () => ({ version: "21.6", openDocuments: [] as { name: string; modified: boolean }[] })), execute: vi.fn(async () => {}) },
  journal: { acquireWorkstation: vi.fn(async () => true), releaseWorkstation: vi.fn(async () => {}),
    claim: vi.fn(async () => true), record: vi.fn(async () => {}) } });
it("does not touch an existing document or claim the job when the workstation is occupied", async () => {
  const input = setup();
  input.session.inspect.mockResolvedValue({ version: "21.6", openDocuments: [{ name: "Unsaved", modified: true }] });
  await expect(executeDesktopJob(input)).rejects.toThrow("Close all");
  expect(input.session.execute).not.toHaveBeenCalled(); expect(input.journal.claim).not.toHaveBeenCalled();
});
it("does not automatically replay an earlier attempt", async () => {
  const input = setup(); input.journal.claim.mockResolvedValue(false);
  await expect(executeDesktopJob(input)).rejects.toThrow("already attempted");
  expect(input.session.execute).not.toHaveBeenCalled();
});
it("leaves timed-out execution for operator recovery and never reports package success", async () => {
  const input = setup(); input.session.execute.mockImplementation(() => new Promise(() => {}));
  await expect(executeDesktopJob(input)).rejects.toThrow("left running");
  expect(input.journal.record).toHaveBeenLastCalledWith(input.jobKey, "needs-attention", expect.stringContaining("timed out"));
  expect(input.journal.releaseWorkstation).not.toHaveBeenCalled();
});
it("records script completion separately from package acceptance", async () => {
  const input = setup(); await executeDesktopJob(input);
  expect(input.journal.record).toHaveBeenLastCalledWith(input.jobKey, "execution-finished", "Package validation remains required.");
  expect(input.journal.releaseWorkstation).toHaveBeenCalledWith(input.jobKey);
});
it("refuses a second job while the workstation has an unresolved attempt", async () => {
  const input = setup(); input.journal.acquireWorkstation.mockResolvedValue(false);
  await expect(executeDesktopJob(input)).rejects.toThrow("requires recovery");
  expect(input.session.inspect).not.toHaveBeenCalled();
  expect(input.session.execute).not.toHaveBeenCalled();
});

it("bounds a stalled inspection without dispatch or automatic lock release", async () => {
  const input = setup(); input.session.inspect.mockImplementation(() => new Promise(() => {}));
  await expect(executeDesktopJob(input)).rejects.toThrow("timed out");
  expect(input.session.execute).not.toHaveBeenCalled();
  expect(input.journal.releaseWorkstation).not.toHaveBeenCalled();
});
