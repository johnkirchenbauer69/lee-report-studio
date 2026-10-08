import { Router } from "express";
import {
  exportRequestSchema,
  jobRequestSchema,
} from "../../src/report-engine/market-assets/contracts.ts";
import type { MarketAssetService } from "../market-assets/service.ts";

/** Same access policy as the existing browser report-instance endpoints. */
export function createMarketAssetRouter(service: MarketAssetService) {
  const router = Router();
  router.get("/reports", async (_req, res, next) => {
    try {
      res.json(await service.reports());
    } catch (e) {
      next(e);
    }
  });
  router.get("/reports/:id", async (req, res, next) => {
    try {
      res.json(await service.report(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  router.post("/preview", async (req, res, next) => {
    try {
      res.json(await service.preview(exportRequestSchema.parse(req.body)));
    } catch (e) {
      next(e);
    }
  });
  router.post("/jobs", async (req, res, next) => {
    try {
      res
        .status(202)
        .json(await service.create(jobRequestSchema.parse(req.body)));
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status) res.status(status).json({ error: (e as Error).message });
      else next(e);
    }
  });
  router.get("/jobs/:id", (req, res) => {
    const job = service.get(req.params.id);
    return job
      ? res.json(job)
      : res.status(404).json({ error: "Export not found or expired." });
  });
  router.post("/jobs/:id/cancel", async (req, res, next) => {
    try {
      const job = await service.cancel(req.params.id);
      return job
        ? res.json(job)
        : res.status(404).json({ error: "Export not found." });
    } catch (e) {
      next(e);
    }
  });
  router.get("/jobs/:id/download", (req, res) => {
    const artifact = service.download(req.params.id);
    if (!artifact)
      return res
        .status(404)
        .json({ error: "Export not completed or expired." });
    res.setHeader("cache-control", "private, no-store");
    return res.download(artifact.file, artifact.name);
  });
  return router;
}
