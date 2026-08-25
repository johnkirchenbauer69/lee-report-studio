import { Router } from "express";
import type { ReportTemplate } from "../../src/types/report.ts";
import type { TemplateRepository } from "../templates/TemplateRepository.ts";

export function createTemplateRouter(repository: TemplateRepository) {
  const router = Router();

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
        response.json(
          await repository.saveDraft(
            request.params.id,
            request.params.version,
            request.body.template as ReportTemplate,
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
  return router;
}
