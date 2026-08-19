import cors from "cors";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ChromiumPdfRenderer } from "./renderers/chromiumPdfRenderer.ts";

interface StoredAsset {
  id: string;
  name: string;
  type: "image" | "logo" | "font";
  mimeType: string;
  source: string;
  createdAt: string;
  fontFamily?: string;
  storage: "backend";
  size: number;
  fileName: string;
}

const app = express();
const port = Number(process.env.PORT ?? 8787);
const dataRoot = path.resolve(process.env.LEE_DATA_DIR ?? "server/data");
const assetDirectory = path.join(dataRoot, "assets");
const manifestPath = path.join(dataRoot, "assets.json");
await mkdir(assetDirectory, { recursive: true });

async function loadManifest(): Promise<StoredAsset[]> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as StoredAsset[];
  } catch {
    return [];
  }
}
async function saveManifest(assets: StoredAsset[]) {
  const temporary = `${manifestPath}.tmp`;
  await writeFile(temporary, JSON.stringify(assets, null, 2), "utf8");
  await rename(temporary, manifestPath);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: assetDirectory,
    filename: (_request, file, done) =>
      done(
        null,
        `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`,
      ),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (_request, file, done) =>
    done(
      null,
      /^(image\/(png|jpeg|webp|svg\+xml)|font\/|application\/(font|x-font|octet-stream))/.test(
        file.mimetype,
      ) || /\.(woff2?|ttf|otf)$/i.test(file.originalname),
    ),
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));
app.get("/api/health", (_request, response) =>
  response.json({ ok: true, storage: "disk", assetDirectory }),
);
app.get("/api/assets", async (_request, response) =>
  response.json({ assets: await loadManifest() }),
);
app.post(
  "/api/assets",
  upload.array("files", 20),
  async (request, response) => {
    const files = (request.files ?? []) as Express.Multer.File[];
    const existing = await loadManifest();
    const assets: StoredAsset[] = files.map((file) => {
      const font = /\.(woff2?|ttf|otf)$/i.test(file.originalname);
      const id = randomUUID();
      return {
        id,
        name: path.parse(file.originalname).name,
        type: font
          ? "font"
          : /logo/i.test(file.originalname)
            ? "logo"
            : "image",
        mimeType: file.mimetype || "application/octet-stream",
        source: `/api/assets/${id}/content`,
        createdAt: new Date().toISOString(),
        fontFamily: font ? path.parse(file.originalname).name : undefined,
        storage: "backend",
        size: file.size,
        fileName: file.filename,
      };
    });
    await saveManifest([...existing, ...assets]);
    response.status(201).json({ assets });
  },
);
app.get("/api/assets/:id/content", async (request, response) => {
  const asset = (await loadManifest()).find(
    (item) => item.id === request.params.id,
  );
  if (!asset) return response.status(404).json({ error: "Asset not found" });
  response.type(asset.mimeType);
  return response.sendFile(asset.fileName, { root: assetDirectory });
});
app.delete("/api/assets/:id", async (request, response) => {
  const assets = await loadManifest(),
    asset = assets.find((item) => item.id === request.params.id);
  if (!asset) return response.status(404).json({ error: "Asset not found" });
  await unlink(path.join(assetDirectory, asset.fileName)).catch(
    () => undefined,
  );
  await saveManifest(assets.filter((item) => item.id !== asset.id));
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
