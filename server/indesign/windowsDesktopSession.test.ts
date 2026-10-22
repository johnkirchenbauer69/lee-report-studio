import { expect, it, vi } from "vitest";
import { WindowsDesktopSession } from "./windowsDesktopSession";

it("reads occupied session names without changing documents", async () => {
  const bridge = vi.fn(async () => "21.6\nUnsaved%20%E2%80%94%20Marketing.indd\t1");
  const session = new WindowsDesktopSession(bridge);
  expect(await session.inspect()).toEqual({ version: "21.6", openDocuments: [{ name: "Unsaved — Marketing.indd", modified: true }] });
  expect(bridge.mock.calls[0]).toBeDefined();
});
it("rejects unreadable state instead of treating it as an empty session", async () => {
  const session = new WindowsDesktopSession(async () => "21.6\nunknown");
  await expect(session.inspect()).rejects.toThrow("Invalid InDesign session state");
});
it("does not dispatch Adobe when the prepared input is absent", async () => {
  const bridge = vi.fn(async () => "execution-finished");
  await expect(new WindowsDesktopSession(bridge).execute("nonexistent-prepared-input")).rejects.toThrow();
  expect(bridge).not.toHaveBeenCalled();
});
