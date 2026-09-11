import { Router, type Response } from "express";
import type { ReportTemplate } from "../../src/types/report.ts";
import type { TemplateRepository } from "../templates/TemplateRepository.ts";
import { TemplateVersionConflictError } from "../templates/FileSystemTemplateRepository.ts";

export function createTemplateRouter(repository: TemplateRepository) {
  const router = Router();
  const conflict = (error: unknown, response: Response) => {
    if (!(error instanceof TemplateVersionConflictError)) return false;
    response.status(409).json({
      error: error.message,
      code: error.code,
      id: error.id,
      version: error.version,
      baseRevision: error.baseRevision,
      currentRevision: error.currentRevision,
    });
    return true;
  };

  router.get("/templates", async (_request, response, next) => {
    try {
      response.json({ templates: await repository.list() });
    } catch (error) {
      next(error);
    }
  });
  router.get("/templates/:id/versions", async (request, response, next) => {
    try {
      response.json({
        versions: await repository.listVersions(request.params.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/templates/:id/published", async (request, response, next) => {
    try {
      const template = await repository.getPublished(request.params.id);
      response
        .status(template ? 200 : 404)
        .json(template ?? { error: "Published template not found." });
    } catch (error) {
      next(error);
    }
  });
  router.get(
    "/templates/:id/versions/:version",
    async (request, response, next) => {
      try {
        const template = await repository.get(
          request.params.id,
          request.params.version,
        );
        response
          .status(template ? 200 : 404)
          .json(template ?? { error: "Template version not found." });
      } catch (error) {
        next(error);
      }
    },
  );
  router.put(
    "/templates/:id/versions/:version",
    async (request, response, next) => {
      try {
        const expectedRevision = request.body?.expectedRevision;
        response.json(
          await repository.saveDraft(
            request.params.id,
            request.params.version,
            request.body.template as ReportTemplate,
            {
              expectedRevision:
                typeof expectedRevision === "number"
                  ? expectedRevision
                  : undefined,
            },
          ),
        );
      } catch (error) {
        if (!conflict(error, response)) next(error);
      }
    },
  );
  router.patch(
    "/templates/:id/versions/:version/label",
    async (request, response, next) => {
      try {
        const label = (request.body as { label?: unknown })?.label;
        if (typeof label !== "string")
          throw new Error("A label string is required.");
        response.json(
          await repository.rename(
            request.params.id,
            request.params.version,
            label,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/templates/:id/versions/:version/new",
    async (request, response, next) => {
      try {
        response
          .status(201)
          .json(
            await repository.createVersion(
              request.params.id,
              request.params.version,
              request.body?.template as ReportTemplate | undefined,
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/templates/:id/versions/:version/publish",
    async (request, response, next) => {
      try {
        response.json(
          await repository.publish(request.params.id, request.params.version),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.delete(
    "/templates/:id/versions/:version",
    async (request, response, next) => {
      try {
        await repository.deleteDraft(request.params.id, request.params.version);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
