import { Router } from "express";
import type { NativeExportService } from "../indesign/nativeService.ts";

export function isLocalOperatorOrigin(
  origin: string | undefined,
  appUrl: string,
) {
  try {
    const supplied = new URL(origin ?? ""),
      expected = new URL(appUrl);
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(supplied.hostname) &&
      supplied.protocol === expected.protocol &&
      supplied.port === expected.port
    );
  } catch {
    return false;
  }
}
export function createNativeExportRouter(
  service: NativeExportService,
  appUrl: string,
) {
  const router = Router();
  router.get("/capabilities", (_req, res) =>
    res.json({
      desktopAvailable: process.platform === "win32",
      unattendedAvailable: false,
    }),
  );
  router.post("/jobs", async (req, res) => {
    if (process.platform !== "win32")
      return res
        .status(503)
        .json({
          error: "Desktop export requires the local Windows installation.",
        });
    if (
      !isLocalOperatorOrigin(req.headers.origin, appUrl) ||
      req.headers["x-lee-desktop-action"] !== "operator-started"
    )
      return res
        .status(403)
        .json({ error: "Start Desktop export from the local application." });
    if (
      typeof req.body.reportId !== "string" ||
      !Number.isInteger(req.body.revision)
    )
      return res
        .status(400)
        .json({ error: "A saved report and revision are required." });
    try {
      return res
        .status(202)
        .json(await service.create(req.body.reportId, req.body.revision));
    } catch (e) {
      return res.status(409).json({ error: (e as Error).message });
    }
  });
  router.get("/jobs/:id", (req, res) => {
    res.setHeader("cache-control", "private, no-store");
    const job = service.get(req.params.id);
    return job
      ? res.json(job)
      : res
          .status(404)
          .json({
            error:
              "Export not found. Check the local job journal after an application restart.",
          });
  });
  router.get("/jobs/:id/download", (req, res) => {
    const file = service.download(req.params.id);
    if (!file)
      return res
        .status(409)
        .json({ error: "Package has not passed native validation." });
    res.setHeader("cache-control", "private, no-store");
    return res.download(file, "InDesign-package.zip");
  });
  return router;
}
