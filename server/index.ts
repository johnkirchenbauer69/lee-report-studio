import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createReportDataRouter } from "./api/reportDataRoutes.ts";
import {
  createReportMcpHandler,
  requireMcpAuthentication,
} from "./mcp/server.ts";
import { createReportDataService } from "./report-data-service/createReportDataService.ts";
import { ChromiumPdfRenderer } from "./renderers/chromiumPdfRenderer.ts";
import { runServerPublicationImagePreflight } from "./renderers/publicationPreflight.ts";
import type { ReportTemplate } from "../src/types/report.ts";
import {
  sanitizeSalesforceClientPayload,
  sanitizeSalesforceDisplayValue,
} from "../src/shared/salesforceIds.ts";
import { FileSystemAssetStore } from "./assets/assetStore.ts";
import {
  AssetReferenceIndex,
  assetDependencyCount,
} from "./assets/assetReferences.ts";
import { createTemplateRouter } from "./api/templateRoutes.ts";
import { FileSystemTemplateRepository } from "./templates/FileSystemTemplateRepository.ts";
import { sampleTemplate } from "../src/data/sampleTemplate.ts";
import { normalizeReportTemplateFonts } from "../src/services/templateNormalization.ts";
import { createReportInstanceRouter } from "./api/reportInstanceRoutes.ts";
import { FileSystemReportInstanceRepository } from "./report-instances/FileSystemReportInstanceRepository.ts";
import {
  MockNarrativeModelClient,
  OpenAINarrativeModelClient,
} from "./narratives/modelClient.ts";
import { NarrativeMcpBridgeClient } from "./narratives/NarrativeMcpBridgeClient.ts";
import {
  NarrativeService,
  type NarrativeGenerationMode,
} from "./narratives/NarrativeService.ts";
import { ArtifactIntegrityCoordinator } from "./integrity/ArtifactIntegrityCoordinator.ts";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const dataRoot = path.resolve(process.env.LEE_DATA_DIR ?? "server/data");
const assetStore = new FileSystemAssetStore(dataRoot);
const artifactIntegrity = new ArtifactIntegrityCoordinator();
const templateRepository = new FileSystemTemplateRepository(
  dataRoot,
  undefined,
  artifactIntegrity,
);
const reportDataService = createReportDataService({ assetStore, dataRoot });
const reportInstanceRepository = new FileSystemReportInstanceRepository(
  dataRoot,
  (entry) => console.info(JSON.stringify(entry)),
  artifactIntegrity,
);
const assetReferenceIndex = new AssetReferenceIndex(
  templateRepository,
  reportInstanceRepository,
  (entry) => console.warn(JSON.stringify(entry)),
);
const narrativeModelClient =
  process.env.NARRATIVE_MODEL_PROVIDER === "mock"
    ? new MockNarrativeModelClient()
    : new OpenAINarrativeModelClient();
// One generation workflow, selected by internal mode — never a user-facing
// provider picker. In chatgpt_mcp mode OPENAI_API_KEY is not required.
const narrativeGenerationMode = (process.env.NARRATIVE_GENERATION_MODE ??
  "chatgpt_mcp") as NarrativeGenerationMode;
const narrativeMcpBridge = new NarrativeMcpBridgeClient({
  url: process.env.NARRATIVE_MCP_URL,
  chatGptAppUrl: process.env.NARRATIVE_MCP_CHATGPT_APP_URL,
  pollIntervalMs: Math.max(
    250,
    Number(process.env.NARRATIVE_MCP_POLL_MS ?? 1500) || 1500,
  ),
});
const narrativeService = new NarrativeService(
  reportInstanceRepository,
  narrativeModelClient,
  Math.max(1, Number(process.env.NARRATIVE_GENERATION_CONCURRENCY ?? 3) || 3),
  undefined,
  { mode: narrativeGenerationMode, bridge: narrativeMcpBridge },
);
await assetStore.initialize();
await reportInstanceRepository.initialize();
await narrativeService.recoverInterruptedJobs();
await templateRepository.initialize(
  normalizeReportTemplateFonts(
    sampleTemplate,
    (await assetStore.list()).filter(
      (asset) => asset.type === "font" && asset.fontFamily,
    ),
  ),
);
const fontGovernance = await assetStore.enforceFontGovernance(
  await templateRepository.listFontAssetReferences(),
);
console.log(
  `Font governance: ${fontGovernance.approved.length} approved, ${fontGovernance.retired.length} retained historical, ${fontGovernance.deleted.length} deleted.`,
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20, fields: 10 },
  fileFilter: (_request, file, done) =>
    done(
      null,
      /^(image\/(png|jpeg|webp|svg\+xml)|font\/|application\/(font|x-font|octet-stream))/.test(
        file.mimetype,
      ) || /\.(woff2?|ttf|otf|zip)$/i.test(file.originalname),
    ),
});

app.use(cors({ origin: true }));
app.all(
  "/mcp",
  requireMcpAuthentication,
  createReportMcpHandler(reportDataService),
);
app.use(express.json({ limit: "10mb" }));
// Every browser-facing JSON response crosses the same display-safety boundary.
// Internal repositories and MCP provenance retain original source identifiers.
app.use("/api", (_request, response, next) => {
  const json = response.json.bind(response);
  response.json = ((body: unknown) =>
    json(sanitizeSalesforceClientPayload(body))) as typeof response.json;
  next();
});
app.get("/api/health", (_request, response) =>
  response.json({
    ok: true,
    storage: "disk",
    assetDirectory: assetStore.assetsRoot,
  }),
);
app.use("/api", createReportDataRouter(reportDataService));
app.use("/api", createTemplateRouter(templateRepository));
app.use(
  "/api",
  createReportInstanceRouter(reportInstanceRepository, narrativeService),
);
app.get("/api/assets", async (_request, response) =>
  response.json({ assets: await assetStore.list() }),
);
app.post(
  "/api/assets",
  upload.array("files", 20),
  async (request, response) => {
    const result = await assetStore.importUploads(
      (request.files ?? []) as Express.Multer.File[],
    );
    response.status(201).json(result);
  },
);
app.get("/api/assets/:id/content", async (request, response) => {
  const asset = (await assetStore.list()).find(
    (item) => item.id === request.params.id,
  );
  if (!asset) return response.status(404).json({ error: "Asset not found" });
  response.type(asset.mimeType);
  response.setHeader("cache-control", "private, max-age=31536000, immutable");
  return response.sendFile(assetStore.resolve(asset));
});
app.delete("/api/assets/:id", async (request, response, next) => {
  const assetId = request.params.id;
  try {
    return await artifactIntegrity.runExclusive(async () => {
      const references = await assetReferenceIndex.dependencies(assetId);
      const referenceCount = assetDependencyCount(references);
      if (referenceCount) {
        console.warn(
          JSON.stringify({
            event: "asset_delete_blocked",
            operation: "asset_delete",
            assetId,
            referenceCount,
          }),
        );
        return response.status(409).json({
          error: `Asset is in use by ${referenceCount} persisted artifact${referenceCount === 1 ? "" : "s"}.`,
          code: "ASSET_IN_USE",
          assetId,
          referenceCount,
          references,
        });
      }
      const outcome = await assetStore.remove(assetId);
      if (outcome === "not-found")
        return response.status(404).json({ error: "Asset not found" });
      console.info(
        JSON.stringify({
          event: "asset_delete_allowed",
          operation: "asset_delete",
          assetId,
          outcome,
        }),
      );
      return outcome === "retained"
        ? response.status(200).json({ outcome })
        : response.status(204).end();
    });
  } catch (error) {
    return next(error);
  }
});

interface RenderJob {
  template: unknown;
  data: unknown;
  title: string;
  renderMode?: "final" | "draft";
}
const renderJobs = new Map<string, RenderJob>();
const pdfRenderer = new ChromiumPdfRenderer();
app.get("/api/render-jobs/:id", (request, response) => {
  const job = renderJobs.get(request.params.id);
  return job
    ? response.json(job)
    : response.status(404).json({ error: "Render job not found" });
});
app.post("/api/render/pdf", async (request, response) => {
  const body = request.body as Partial<RenderJob>;
  if (!body.template || !body.data)
    return response.status(400).json({
      error: "Template and normalized presentation data are required.",
    });
  const appUrl = process.env.LEE_RENDER_APP_URL ?? "http://127.0.0.1:3000";
  if (body.renderMode !== "draft") {
    const imageIssues = await runServerPublicationImagePreflight(
      body.template as ReportTemplate,
      { baseUrl: appUrl },
    );
    if (imageIssues.length) {
      console.warn(
        JSON.stringify({
          event: "publication_image_preflight_failed",
          issueCount: imageIssues.length,
          codes: [...new Set(imageIssues.map((issue) => issue.code))],
        }),
      );
      return response.status(422).json({
        error: "Final PDF publication is blocked by required image preflight.",
        code: imageIssues[0]!.code,
        issues: imageIssues,
      });
    }
  }
  const id = randomUUID();
  renderJobs.set(id, {
    template: body.template,
    data: body.data,
    title: body.title ?? "LEE Market Report",
  });
  try {
    const pdf = await pdfRenderer.render({
      url: `${appUrl}/?printJob=${encodeURIComponent(id)}`,
      title: body.title ?? "LEE Market Report",
    });
    response.type("application/pdf");
    response.setHeader(
      "content-disposition",
      'attachment; filename="lee-market-report.pdf"',
    );
    return response.send(Buffer.from(pdf));
  } finally {
    renderJobs.delete(id);
  }
});

const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.use((_request, response) =>
    response.sendFile(path.join(dist, "index.html")),
  );
}
app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    const code =
      typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : undefined;
    response.status(code?.startsWith("SALESFORCE_") ? 503 : 400).json({
      error:
        error instanceof Error
          ? sanitizeSalesforceDisplayValue(error.message, "Salesforce record")
          : "The request could not be completed.",
      ...(code ? { code } : {}),
    });
  },
);
app.listen(port, "127.0.0.1", async () => {
  console.log(`LEE Report Studio API listening on http://127.0.0.1:${port}`);
  if (narrativeGenerationMode !== "chatgpt_mcp") return;
  const health = await narrativeService.bridgeHealth({ force: true });
  console.log(
    health.configured
      ? `Narrative MCP bridge ready at ${health.mcpUrl} (${health.toolCount} tools).`
      : `Narrative MCP bridge unavailable: ${health.error ?? `missing ${health.missingTools.join(", ")}`}`,
  );
});
