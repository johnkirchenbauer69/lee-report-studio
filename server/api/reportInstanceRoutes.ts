import { Router } from "express";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import type { FileSystemReportInstanceRepository } from "../report-instances/FileSystemReportInstanceRepository.ts";
import type { NarrativeService } from "../narratives/NarrativeService.ts";

const textBody = (body: unknown) => {
  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || text.length > 10_000)
    throw new Error("Narrative text must be a string no longer than 10,000 characters.");
  return text;
};

export function createReportInstanceRouter(
  repository: FileSystemReportInstanceRepository,
  narratives: NarrativeService,
) {
  const router = Router();
  router.get("/narratives/config", (_request, response) =>
    response.json(narratives.config()),
  );
  router.post("/report-instances", async (request, response, next) => {
    try {
      const instance = request.body as ReportInstance;
      if (!instance?.id || instance.narratives?.length !== 19)
        throw new Error("A complete ReportInstance with 19 narrative records is required.");
      response.status(201).json(await repository.save(instance));
    } catch (error) {
      next(error);
    }
  });
  router.get("/report-instances/:id", async (request, response, next) => {
    try {
      const instance = await repository.get(request.params.id);
      if (!instance) return response.status(404).json({ error: "Report instance not found." });
      return response.json(instance);
    } catch (error) {
      return next(error);
    }
  });
  router.put("/report-instances/:id", async (request, response, next) => {
    try {
      const instance = request.body as ReportInstance;
      if (instance.id !== request.params.id)
        throw new Error("Report instance identifier does not match the route.");
      response.json(await repository.save(instance));
    } catch (error) {
      next(error);
    }
  });
  router.post("/report-instances/:id/narratives/refresh", async (request, response, next) => {
    try {
      response.json(await narratives.refreshStaleness(request.params.id));
    } catch (error) {
      next(error);
    }
  });
  router.post("/report-instances/:id/narratives/generate-all", async (request, response, next) => {
    try {
      response.status(202).json(await narratives.startGenerateAll(request.params.id));
    } catch (error) {
      next(error);
    }
  });
  router.get("/report-instances/:id/narrative-jobs/:jobId", async (request, response, next) => {
    try {
      const job = narratives.job(request.params.jobId);
      if (job.reportInstanceId !== request.params.id)
        throw new Error("Narrative generation job does not belong to this report.");
      response.json(job);
    } catch (error) {
      next(error);
    }
  });
  router.get("/report-instances/:id/narratives/:marketId/context", async (request, response, next) => {
    try {
      response.json(await narratives.context(request.params.id, request.params.marketId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/report-instances/:id/narratives/:marketId/generate", async (request, response, next) => {
    try {
      const body = request.body as { instruction?: unknown; confirmApproved?: unknown };
      const instruction =
        typeof body?.instruction === "string" ? body.instruction.slice(0, 300) : undefined;
      response.json(
        await narratives.generate(request.params.id, request.params.marketId, {
          instruction,
          confirmApproved: body?.confirmApproved === true,
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  router.patch("/report-instances/:id/narratives/:marketId", async (request, response, next) => {
    try {
      response.json(
        await narratives.edit(
          request.params.id,
          request.params.marketId,
          textBody(request.body),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/report-instances/:id/narratives/:marketId/approve", async (request, response, next) => {
    try {
      response.json(await narratives.approve(request.params.id, request.params.marketId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/report-instances/:id/narratives/:marketId/unlock", async (request, response, next) => {
    try {
      response.json(await narratives.unlock(request.params.id, request.params.marketId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/report-instances/:id/narratives/:marketId/restore", async (request, response, next) => {
    try {
      const revisionId = (request.body as { revisionId?: unknown })?.revisionId;
      if (typeof revisionId !== "string") throw new Error("Revision identifier is required.");
      response.json(await narratives.restore(request.params.id, request.params.marketId, revisionId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/report-instances/:id/narratives/:marketId/overflow", async (request, response, next) => {
    try {
      const overflow = (request.body as { overflow?: unknown })?.overflow;
      if (typeof overflow !== "boolean") throw new Error("Overflow state must be boolean.");
      response.json(await narratives.setOverflow(request.params.id, request.params.marketId, overflow));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
