import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ launchServer: vi.fn(), connect: vi.fn() }));
vi.mock("playwright", () => ({ chromium: mock }));
import { ChromiumPdfRenderer } from "./chromiumPdfRenderer";

afterEach(() => vi.resetAllMocks());
function setup() {
  const server = { wsEndpoint: () => "ws://test", close: vi.fn().mockResolvedValue(undefined), kill: vi.fn().mockResolvedValue(undefined) };
  mock.launchServer.mockResolvedValue(server);
  return server;
}
describe("Chromium render lifecycle", () => {
  it("bounds an unresolved browser operation and closes its owned browser", async () => {
    const server = setup();
    mock.connect.mockImplementation(() => new Promise(() => {}));
    await expect(new ChromiumPdfRenderer().render({ url: "http://localhost", title: "test", timeoutMs: 25 })).rejects.toThrow("deadline exceeded");
    expect(server.close).toHaveBeenCalledOnce();
  });
  it("propagates readiness failure and kills its own browser when close fails", async () => {
    const server = setup();
    server.close.mockRejectedValue(new Error("close failed"));
    const page = { on: vi.fn(), emulateMedia: vi.fn(), goto: vi.fn(), waitForFunction: vi.fn().mockRejectedValue(new Error("readiness failed")) };
    mock.connect.mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) });
    await expect(new ChromiumPdfRenderer().render({ url: "http://localhost", title: "test" })).rejects.toThrow("readiness failed");
    expect(server.kill).toHaveBeenCalledOnce();
  });
  it("does not launch for an already cancelled job", async () => {
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await expect(new ChromiumPdfRenderer().render({ url: "http://localhost", title: "test", signal: controller.signal })).rejects.toThrow("cancelled");
    expect(mock.launchServer).not.toHaveBeenCalled();
  });
});
