import { Router } from "express";
import type { ReportDataService } from "../report-data-service/ReportDataService.ts";

export function createReportDataRouter(service: ReportDataService) {
  const router = Router();
  router.post(
    "/report-data/industrial-market",
    async (request, response, next) => {
      try {
        response.json(await service.getIndustrialMarketReport(request.body));
      } catch (error) {
        next(error);
      }
    },
  );
  router.get("/report-snapshots/:id", async (request, response, next) => {
    try {
      const snapshot = await service.getSnapshot(request.params.id);
      if (!snapshot) {
        response.status(404).json({ error: "Report snapshot not found." });
        return;
      }
      response.json(snapshot);
    } catch (error) {
      next(error);
    }
  });
  router.get(
    "/integrations/salesforce/health",
    async (_request, response, next) => {
      try {
        response.json(await service.getStatus());
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
