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
import { FileSystemAssetStore } from "./assets/assetStore.ts";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const dataRoot = path.resolve(process.env.LEE_DATA_DIR ?? "server/data");
const assetStore = new FileSystemAssetStore(dataRoot);
const reportDataService = createReportDataService();
await assetStore.initialize();

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
app.get("/api/health", (_request, response) =>
  response.json({
    ok: true,
    storage: "disk",
    assetDirectory: assetStore.assetsRoot,
  }),
);
app.use("/api", createReportDataRouter(reportDataService));
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
app.delete("/api/assets/:id", async (request, response) => {
  if (!(await assetStore.remove(request.params.id)))
    return response.status(404).json({ error: "Asset not found" });
  return response.status(204).end();
});

interface RenderJob {
  template: unknown;
  data: unknown;
  title: string;
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
  const id = randomUUID();
  renderJobs.set(id, {
    template: body.template,
    data: body.data,
    title: body.title ?? "LEE Market Report",
  });
  try {
    const appUrl = process.env.LEE_RENDER_APP_URL ?? "http://127.0.0.1:3000";
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
    response.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "The request could not be completed.",
    });
  },
);
app.listen(port, "127.0.0.1", () =>
  console.log(`LEE Report Studio API listening on http://127.0.0.1:${port}`),
);
