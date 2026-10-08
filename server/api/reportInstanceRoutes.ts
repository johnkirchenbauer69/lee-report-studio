import { Router, type Response } from "express";
import multer from "multer";
import {
  BROKER_INTERVIEW_MAX_BYTES,
  BrokerInterviewIngestionError,
} from "../narratives/brokerInterviewIngestion.ts";
import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import {
  normalizeReportInstance,
  reportDocumentPatchSchema,
  ReportInstanceValidationError,
} from "../../src/report-engine/schema/reportInstancePersistence.ts";
import {
  ReportInstanceConflictError,
  type FileSystemReportInstanceRepository,
} from "../report-instances/FileSystemReportInstanceRepository.ts";
import type { NarrativeService } from "../narratives/NarrativeService.ts";

const textBody = (body: unknown) => {
  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || text.length > 10_000)
    throw new Error(
      "Narrative text must be a string no longer than 10,000 characters.",
    );
  return text;
};

export function createReportInstanceRouter(
  repository: FileSystemReportInstanceRepository,
  narratives: NarrativeService,
  capture?: (instance: ReportInstance) => Promise<ReportInstance>,
) {
  const router = Router();
  const conflict = (error: unknown, response: Response) => {
    if (!(error instanceof ReportInstanceConflictError)) return false;
    response.status(409).json({
      error: error.message,
      code: error.code,
      reportId: error.reportId,
      baseRevision: error.baseRevision,
      currentRevision: error.currentRevision,
    });
    return true;
  };
  const validationRejection = (
    error: unknown,
    response: Response,
    operation: string,
    reportId?: string,
  ) => {
    if (
      !(error instanceof ReportInstanceValidationError) &&
      (error as { name?: unknown })?.name !== "ZodError"
    )
      return false;
    console.warn(
      JSON.stringify({
        event: "report_validation_rejection",
        operation,
        reportId: reportId ?? "unknown",
        errorName: error instanceof Error ? error.name : "ValidationError",
      }),
    );
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid ReportInstance.",
      code: "INVALID_REPORT_INSTANCE",
    });
    return true;
  };
  // Optional broker interview upload (PDF/DOCX). Held in memory only for
  // parsing; the raw file is never written to disk or sent to Salesforce.
  const brokerUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: BROKER_INTERVIEW_MAX_BYTES, files: 1, fields: 4 },
  }).single("file");
  router.post(
    "/report-instances/:id/broker-interviews",
    (request, response, next) =>
      brokerUpload(request, response, (error: unknown) => {
        if (!error) return next();
        const tooLarge = (error as { code?: string })?.code === "LIMIT_FILE_SIZE";
        response.status(tooLarge ? 413 : 400).json({
          error: tooLarge
            ? "Broker interview files must be 15 MB or smaller."
            : "The broker interview upload could not be read.",
          code: tooLarge ? "FILE_TOO_LARGE" : "UPLOAD_FAILED",
        });
      }),
    async (request, response, next) => {
      try {
        const file = request.file;
        if (!file) {
          response.status(400).json({
            error: "Choose a PDF or Word (.docx) broker interview file.",
            code: "NO_FILE",
          });
          return;
        }
        response.json(
          await narratives.uploadBrokerInterviews(request.params.id, {
            fileName: Buffer.from(file.originalname, "latin1").toString("utf8"),
            bytes: new Uint8Array(file.buffer),
          }),
        );
      } catch (error) {
        if (error instanceof BrokerInterviewIngestionError) {
          response.status(422).json({ error: error.message, code: error.code });
          return;
        }
        if (conflict(error, response)) return;
        next(error);
      }
    },
  );
  router.delete(
    "/report-instances/:id/broker-interviews",
    async (request, response, next) => {
      try {
        response.json(await narratives.removeBrokerInterviews(request.params.id));
      } catch (error) {
        if (conflict(error, response)) return;
        next(error);
      }
    },
  );
  router.get("/narratives/config", async (_request, response, next) => {
    try {
      response.json(await narratives.config());
    } catch (error) {
      next(error);
    }
  });
  // Health of the remote LEE Intelligence MCP narrative bridge. Reports
  // reachability and tool discovery only — never credentials.
  router.get(
    "/integrations/narrative-mcp/health",
    async (request, response, next) => {
      try {
        response.json(
          await narratives.bridgeHealth({ force: request.query.force === "1" }),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.post("/report-instances", async (request, response, next) => {
    try {
      const instance = normalizeReportInstance(request.body);
      response.status(201).json(await repository.create(capture ? await capture(instance) : instance));
    } catch (error) {
      if (
        !conflict(error, response) &&
        !validationRejection(
          error,
          response,
          "create",
          (request.body as { id?: string })?.id,
        )
      )
        next(error);
    }
  });
  router.get("/report-instances/:id", async (request, response, next) => {
    try {
      const instance = await repository.get(request.params.id);
      if (!instance)
        return response
          .status(404)
          .json({ error: "Report instance not found." });
      return response.json(instance);
    } catch (error) {
      return next(error);
    }
  });
  router.put("/report-instances/:id", async (request, response, next) => {
    try {
      const instance = normalizeReportInstance(request.body) as ReportInstance;
      if (instance.id !== request.params.id)
        throw new Error("Report instance identifier does not match the route.");
      response.json(
        await repository.save(instance, {
          expectedRevision: instance.revision,
          operation: "api_replace",
        }),
      );
    } catch (error) {
      if (
        !conflict(error, response) &&
        !validationRejection(error, response, "api_replace", request.params.id)
      )
        next(error);
    }
  });
  router.patch(
    "/report-instances/:id/document",
    async (request, response, next) => {
      try {
        const patch = reportDocumentPatchSchema.parse(request.body);
        response.json(await repository.patchDocument(request.params.id, patch));
      } catch (error) {
        if (
          !conflict(error, response) &&
          !validationRejection(
            error,
            response,
            "editor_document_patch",
            request.params.id,
          )
        )
          next(error);
      }
    },
  );
  router.post(
    "/report-instances/:id/narratives/refresh",
    async (request, response, next) => {
      try {
        response.json(await narratives.refreshStaleness(request.params.id));
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/report-instances/:id/narratives/generate-all",
    async (request, response, next) => {
      try {
        response
          .status(202)
          .json(await narratives.startGenerateAll(request.params.id));
      } catch (error) {
        next(error);
      }
    },
  );
  // Creates the remote narrative job and parks the report in "Waiting for
  // ChatGPT". The browser never speaks MCP; this server does.
  router.post(
    "/report-instances/:id/narratives/external-job",
    async (request, response, next) => {
      try {
        const body = (request.body ?? {}) as {
          marketIds?: string[];
          instruction?: string;
          confirmApproved?: boolean;
          includeReviewed?: boolean;
        };
        response.status(202).json(
          await narratives.startExternalGeneration(request.params.id, {
            marketIds: Array.isArray(body.marketIds)
              ? body.marketIds
              : undefined,
            instruction:
              typeof body.instruction === "string"
                ? body.instruction
                : undefined,
            confirmApproved: body.confirmApproved === true,
            includeReviewed: body.includeReviewed === true,
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  // Re-imports a batch still held by the MCP after a rejected import.
  router.post(
    "/report-instances/:id/narratives/external-job/reimport",
    async (request, response, next) => {
      try {
        response.json(
          await narratives.retryExternalJobImport(request.params.id),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  // Browser poll target. This server polls the remote MCP and imports the
  // batch automatically once ChatGPT submits it.
  router.get(
    "/report-instances/:id/narratives/external-job",
    async (request, response, next) => {
      try {
        const state = await narratives.externalJobState(request.params.id);
        response.json({
          job: state.job ?? null,
          instance: state.instance,
          pollIntervalMs: narratives.pollIntervalMs,
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    "/report-instances/:id/narrative-jobs/:jobId",
    async (request, response, next) => {
      try {
        const job = narratives.job(request.params.jobId);
        if (job.reportInstanceId !== request.params.id)
          throw new Error(
            "Narrative generation job does not belong to this report.",
          );
        response.json(job);
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    "/report-instances/:id/narratives/:marketId/context",
    async (request, response, next) => {
      try {
        response.json(
          await narratives.context(request.params.id, request.params.marketId),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/report-instances/:id/narratives/:marketId/generate",
    async (request, response, next) => {
      try {
        const body = request.body as {
          instruction?: unknown;
          confirmApproved?: unknown;
        };
        const instruction =
          typeof body?.instruction === "string"
            ? body.instruction.slice(0, 300)
            : undefined;
        response.json(
          await narratives.generate(
            request.params.id,
            request.params.marketId,
            {
              instruction,
              confirmApproved: body?.confirmApproved === true,
            },
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.patch(
    "/report-instances/:id/narratives/:marketId",
    async (request, response, next) => {
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
    },
  );
  router.post(
    "/report-instances/:id/narratives/:marketId/approve",
    async (request, response, next) => {
      try {
        response.json(
          await narratives.approve(request.params.id, request.params.marketId),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/report-instances/:id/narratives/:marketId/unlock",
    async (request, response, next) => {
      try {
        response.json(
          await narratives.unlock(request.params.id, request.params.marketId),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/report-instances/:id/narratives/:marketId/restore",
    async (request, response, next) => {
      try {
        const revisionId = (request.body as { revisionId?: unknown })
          ?.revisionId;
        if (typeof revisionId !== "string")
          throw new Error("Revision identifier is required.");
        response.json(
          await narratives.restore(
            request.params.id,
            request.params.marketId,
            revisionId,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/report-instances/:id/narratives/:marketId/overflow",
    async (request, response, next) => {
      try {
        const overflow = (request.body as { overflow?: unknown })?.overflow;
        if (typeof overflow !== "boolean")
          throw new Error("Overflow state must be boolean.");
        response.json(
          await narratives.setOverflow(
            request.params.id,
            request.params.marketId,
            overflow,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
