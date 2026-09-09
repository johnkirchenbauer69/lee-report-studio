import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport";
import { CHICAGO_SUBMARKETS } from "../../src/report-engine/submarkets";
import type { ReportInstance } from "../../src/report-engine/schema/generation";
import type {
  Asset,
  ImageElement,
  ReportPage,
  ReportTemplate,
  ShapeElement,
  TableElement,
  TextElement,
} from "../../src/types/report";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "../../src/types/templateLibrary";

const reportKey = "lee-report-studio.report-instance.v1";
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const templateUrl = (id: string, version: string) =>
  `/api/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`;

async function sourceRecord(request: APIRequestContext) {
  const response = await request.get("/api/templates");
  expect(response.ok(), await response.text()).toBeTruthy();
  const { templates } = (await response.json()) as {
    templates: TemplateVersionSummary[];
  };
  const source = [...templates].sort(
    (left, right) => right.pageDefinitionCount - left.pageDefinitionCount,
  )[0]!;
  return (await (
    await request.get(templateUrl(source.id, source.version))
  ).json()) as StoredTemplateVersion;
}

async function createVersion(
  request: APIRequestContext,
  source: StoredTemplateVersion,
  template: ReportTemplate,
) {
  const response = await request.post(
    `${templateUrl(source.id, source.version)}/new`,
    { data: { template } },
  );
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as StoredTemplateVersion;
}

async function saveDraft(
  request: APIRequestContext,
  draft: StoredTemplateVersion,
  template: ReportTemplate,
) {
  const response = await request.put(templateUrl(draft.id, draft.version), {
    data: { template },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as StoredTemplateVersion;
}

async function publish(
  request: APIRequestContext,
  draft: StoredTemplateVersion,
) {
  const response = await request.post(
    `${templateUrl(draft.id, draft.version)}/publish`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as StoredTemplateVersion;
}

function editorFixture(
  source: ReportTemplate,
  token: string,
  asset?: Asset,
): ReportTemplate {
  const text: TextElement = {
    id: `${token}-text`,
    type: "text",
    name: "Immutable text",
    x: 40,
    y: 40,
    width: 260,
    height: 60,
    text: "Published source text",
    style: {
      typography: {
        fontFamily: "Arial",
        fontWeight: 400,
        fontStyle: "normal",
        fontSize: 20,
        color: "#172033",
        letterSpacing: 0,
        lineHeight: 1.2,
        textAlign: "left",
        verticalAlign: "top",
        italic: false,
        underline: false,
      },
      opacity: 1,
    },
  };
  const shape = (id: string, x: number): ShapeElement => ({
    id,
    type: "shape",
    name: id,
    x,
    y: 140,
    width: 160,
    height: 110,
    shape: "rounded-rectangle",
    style: {
      fill: { type: "solid", color: "#dce7f4" },
      borderRadius: 12,
      cornerRadii: {
        topLeft: 12,
        topRight: 12,
        bottomRight: 12,
        bottomLeft: 12,
        linked: true,
      },
      opacity: 1,
    },
  });
  const image: ImageElement = {
    id: `${token}-image`,
    type: "image",
    name: "Managed fixture image",
    x: 390,
    y: 40,
    width: 180,
    height: 120,
    src:
      asset?.source ??
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Cpath fill='%23173b64' d='M0 0h4v4H0z'/%3E%3C/svg%3E",
    assetId: asset?.id,
    fit: "cover",
    crop: { x: 50, y: 50, zoom: 1 },
    style: {
      borderRadius: 8,
      cornerRadii: {
        topLeft: 8,
        topRight: 8,
        bottomRight: 8,
        bottomLeft: 8,
        linked: true,
      },
      opacity: 1,
    },
  };
  const table: TableElement = {
    id: `${token}-table`,
    type: "table",
    name: "Immutable table",
    x: 40,
    y: 300,
    width: 530,
    height: 180,
    sourcePath: "submarkets",
    columns: [{ key: "name", label: "Submarket", path: "name" }],
    rowHeight: 24,
    style: { opacity: 1 },
  };
  const page: ReportPage = {
    id: `${token}-page`,
    name: `Phase 1B ${token}`,
    width: 816,
    height: 1056,
    background: "#ffffff",
    elements: [
      text,
      shape(`${token}-shape-a`, 40),
      shape(`${token}-shape-b`, 150),
      image,
      table,
    ],
  };
  return {
    ...structuredClone(source),
    name: `Phase 1B ${token}`,
    pages: [page],
    assets: asset
      ? [...(source.assets ?? []).filter((item) => item.id !== asset.id), asset]
      : source.assets,
  };
}

async function openVersion(page: Page, version: string, status: string) {
  await page.goto("/", { waitUntil: "load" });
  await page.getByRole("button", { name: /Templates/ }).click();
  const card = page
    .locator(".template-version-list section")
    .filter({ hasText: `v${version} · ${status}` });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Open", exact: true }).click();
}

async function uploadImage(
  request: APIRequestContext,
  name: string,
  bytes = PNG_BYTES,
) {
  const response = await request.post("/api/assets", {
    multipart: {
      files: { name, mimeType: "image/png", buffer: bytes },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const result = (await response.json()) as { assets: Asset[] };
  expect(result.assets).toHaveLength(1);
  return result.assets[0]!;
}

async function exportTemplate(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  return JSON.parse(await readFile(downloadedPath!, "utf8")) as ReportTemplate;
}

test("published templates reject canvas, keyboard, inspector, creation, grouping, and history mutations", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const source = await sourceRecord(request);
  const token = `readonly-${crypto.randomUUID().slice(0, 8)}`;
  const created = await createVersion(
    request,
    source,
    editorFixture(source.template, token),
  );
  const published = await publish(request, created);
  const before = structuredClone(published.template.pages);

  await openVersion(page, published.version, "published");
  await expect(page.locator(".topbar")).toContainText("Published — Read Only");
  await expect(page.locator(".statusbar")).toContainText("0 history steps");
  const inMemoryBefore = await exportTemplate(page);

  const text = page.getByTestId(`${token}-text`);
  await text.click();
  await expect(page.locator("aside.inspector")).toHaveAttribute("inert", "");
  const originalTextBox = await text.boundingBox();
  expect(originalTextBox).not.toBeNull();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Delete");
  expect(await text.boundingBox()).toEqual(originalTextBox);

  await page.getByRole("button", { name: /Text/ }).click();
  await page.getByRole("button", { name: "Add a heading" }).click();
  await expect(page.locator(".page-canvas [data-testid]")).toHaveCount(5);

  const shape = page.getByTestId(`${token}-shape-a`);
  await shape.click();
  await expect(shape.locator(".resize-handle")).toHaveCount(0);
  await expect(shape.locator(".rotation-handle")).toHaveCount(0);
  await expect(shape.locator(".corner-radius-handle")).toHaveCount(0);
  const shapeBox = await shape.boundingBox();
  expect(shapeBox).not.toBeNull();
  await page.mouse.move(shapeBox!.x + 20, shapeBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(shapeBox!.x + 80, shapeBox!.y + 70);
  await page.mouse.up();
  expect(await shape.boundingBox()).toEqual(shapeBox);

  await page.getByTestId(`${token}-shape-b`).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+g");
  await expect(page.locator("aside.inspector")).toContainText("Union shapes");
  await expect(page.getByTitle("Align selected boxes left")).toBeVisible();

  await page.getByTestId(`${token}-image`).click();
  await expect(page.locator(".replace-image-button")).toBeVisible();
  await expect(page.locator(".crop-button")).toContainText("Crop image");

  await page.getByTestId(`${token}-table`).click();
  await expect(page.locator(".crop-button")).toContainText("Edit table");
  await expect(page.locator('[aria-label="Table row height"]')).toBeVisible();

  await expect(page.locator(".statusbar")).toContainText("0 history steps");
  const exported = await exportTemplate(page);
  expect(exported.pages).toEqual(inMemoryBefore.pages);

  const after = (await (
    await request.get(templateUrl(published.id, published.version))
  ).json()) as StoredTemplateVersion;
  expect(after.template.pages).toEqual(before);
  expect(after.checksum).toBe(published.checksum);

  await page.getByRole("button", { name: /Templates/ }).click();
  const publishedCard = page
    .locator(".template-version-list section")
    .filter({ hasText: `v${published.version} · published` });
  await publishedCard
    .getByRole("button", { name: "Create Draft From Version" })
    .click();
  await expect(page.locator(".topbar")).toContainText("· draft");
  await page.getByTestId(`${token}-text`).click();
  await expect(page.getByLabel("Layer name")).toBeEnabled();
  await page.getByLabel("Layer name").fill("Editable successor text");
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      /\/api\/templates\/[^/]+\/versions\/[^/]+$/.test(response.url()),
  );
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  expect((await saveResponse).status()).toBe(200);

  const summaries = (await (await request.get("/api/templates")).json()) as {
    templates: TemplateVersionSummary[];
  };
  const successor = summaries.templates.find(
    (record) =>
      record.id === published.id &&
      record.status === "draft" &&
      record.parentVersion === published.version,
  )!;
  const successorRecord = (await (
    await request.get(templateUrl(successor.id, successor.version))
  ).json()) as StoredTemplateVersion;
  expect(
    successorRecord.template.pages[0]!.elements.find(
      (element) => element.id === `${token}-text`,
    )?.name,
  ).toBe("Editable successor text");
  expect(
    (
      (await (
        await request.get(templateUrl(published.id, published.version))
      ).json()) as StoredTemplateVersion
    ).template.pages,
  ).toEqual(before);
});

test("asset deletion reports every draft, published, archived, and report dependency and preserves bytes", async ({
  request,
}) => {
  test.setTimeout(120_000);
  const source = await sourceRecord(request);
  const asset = await uploadImage(request, "phase1b-shared-logo.png");
  const token = `asset-${crypto.randomUUID().slice(0, 8)}`;
  const created = await createVersion(
    request,
    source,
    editorFixture(source.template, token, asset),
  );
  const published = await publish(request, created);
  const successor = await createVersion(request, published, published.template);
  const report = await generateReportInstance(published.template, {
    templateId: published.id,
    templateVersion: published.version,
    templateChecksum: published.checksum,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
  report.id = `report-${crypto.randomUUID()}`;
  const createReportResponse = await request.post("/api/report-instances", {
    data: report,
  });
  expect(
    createReportResponse.ok(),
    await createReportResponse.text(),
  ).toBeTruthy();

  const deletion = await request.delete(`/api/assets/${asset.id}`);
  expect(deletion.status()).toBe(409);
  const conflict = (await deletion.json()) as {
    code: string;
    assetId: string;
    referenceCount: number;
    references: {
      draftTemplates: Array<{ artifactId: string; version: string }>;
      publishedTemplates: Array<{ artifactId: string; version: string }>;
      archivedTemplates: Array<{ artifactId: string; version: string }>;
      reportInstances: Array<{ artifactId: string; version: string }>;
    };
  };
  expect(conflict).toMatchObject({
    code: "ASSET_IN_USE",
    assetId: asset.id,
    referenceCount: 3,
  });
  expect(conflict.references.draftTemplates).toContainEqual(
    expect.objectContaining({
      artifactId: successor.id,
      version: successor.version,
    }),
  );
  expect(conflict.references.publishedTemplates).toContainEqual(
    expect.objectContaining({
      artifactId: published.id,
      version: published.version,
    }),
  );
  expect(conflict.references.reportInstances).toContainEqual(
    expect.objectContaining({ artifactId: report.id }),
  );
  expect((await request.get(`/api/assets/${asset.id}/content`)).status()).toBe(
    200,
  );

  const unused = await uploadImage(
    request,
    "phase1b-unused.png",
    Buffer.concat([PNG_BYTES, Buffer.from("unused")]),
  );
  expect((await request.delete(`/api/assets/${unused.id}`)).status()).toBe(204);
  expect((await request.get(`/api/assets/${unused.id}/content`)).status()).toBe(
    404,
  );

  const nonexistentButReferenced = published.template.pages[0]!
    .elements[3] as ImageElement;
  nonexistentButReferenced.assetId = "phase1b-missing-legacy-asset";
  nonexistentButReferenced.src =
    "/api/assets/phase1b-missing-legacy-asset/content";
  await saveDraft(request, successor, published.template);
  const missingDeletion = await request.delete(
    "/api/assets/phase1b-missing-legacy-asset",
  );
  expect(missingDeletion.status()).toBe(409);
  expect((await missingDeletion.json()).code).toBe("ASSET_IN_USE");
});

test("a generated 44-page report reopens and exports after its source draft is deleted", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await sourceRecord(request);
  const token = `snapshot-${crypto.randomUUID().slice(0, 8)}`;
  const draftTemplate = structuredClone(source.template);
  const marker: TextElement = {
    id: `${token}-marker`,
    type: "text",
    name: "Snapshot independence marker",
    x: 32,
    y: 32,
    width: 300,
    height: 32,
    text: "Independent report snapshot",
    style: {
      typography: {
        fontFamily: "Arial",
        fontWeight: 700,
        fontStyle: "normal",
        fontSize: 14,
        color: "#172033",
        letterSpacing: 0,
        lineHeight: 1.2,
        textAlign: "left",
        verticalAlign: "top",
        italic: false,
        underline: false,
      },
    },
  };
  draftTemplate.pages[0]!.elements.push(marker);
  draftTemplate.name = `Phase 1B ${token}`;
  const draft = await createVersion(request, source, draftTemplate);
  const report = await generateReportInstance(draft.template, {
    templateId: draft.id,
    templateVersion: draft.version,
    templateChecksum: draft.checksum,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: {
      submarketIds: CHICAGO_SUBMARKETS.map((submarket) => submarket.id),
    },
    source: { provider: "sample" },
  });
  report.id = `report-${crypto.randomUUID()}`;
  expect(report.pages).toHaveLength(44);
  expect(report.sourceTemplateSnapshot).toEqual({
    name: draft.template.name,
    settings: draft.template.settings,
  });
  const saved = (await (
    await request.post("/api/report-instances", { data: report })
  ).json()) as ReportInstance;

  const deleted = await request.delete(templateUrl(draft.id, draft.version));
  expect(deleted.status(), await deleted.text()).toBe(204);
  expect(
    (await request.get(templateUrl(draft.id, draft.version))).status(),
  ).toBe(404);

  const context = await browser.newContext({
    viewport: { width: 900, height: 1120 },
  });
  await context.addInitScript(({ key, id }) => localStorage.setItem(key, id), {
    key: reportKey,
    id: saved.id,
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator(".topbar")).toContainText("Report Instance");
  await expect(page.getByTestId(marker.id)).toBeVisible();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.locator(".left-panel")).toContainText(
    /Validation|QA|issue/i,
  );

  const restored = (await (
    await request.get(`/api/report-instances/${saved.id}`)
  ).json()) as ReportInstance;
  expect(restored.dataSnapshot.submarkets).toHaveLength(18);
  expect(restored.pages).toHaveLength(44);
  const pdfResponse = await request.post("/api/render/pdf", {
    data: {
      template: {
        id: restored.templateId,
        version: restored.templateVersion,
        name: restored.sourceTemplateSnapshot!.name,
        settings: restored.sourceTemplateSnapshot!.settings,
        pages: restored.pages,
      },
      data: buildPresentationModel(restored.dataSnapshot),
      title: "Phase 1B source-independent report",
    },
    timeout: 120_000,
  });
  expect(pdfResponse.ok(), await pdfResponse.text()).toBeTruthy();
  expect(
    (await PDFDocument.load(await pdfResponse.body())).getPageCount(),
  ).toBe(44);
  await context.close();
});

test("a legacy report without snapshot metadata is not forgotten when its source is missing", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const source = await sourceRecord(request);
  const token = `legacy-${crypto.randomUUID().slice(0, 8)}`;
  const draftTemplate = structuredClone(source.template);
  const marker = draftTemplate.pages[0]!.elements.find(
    (element): element is TextElement => element.type === "text",
  )!;
  marker.id = `${token}-marker`;
  marker.name = "Legacy restore marker";
  marker.text = "Legacy report survived its source";
  marker.binding = undefined;
  const draft = await createVersion(request, source, draftTemplate);
  const report = await generateReportInstance(draft.template, {
    templateId: draft.id,
    templateVersion: draft.version,
    templateChecksum: draft.checksum,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
  report.id = `report-${crypto.randomUUID()}`;
  delete report.sourceTemplateSnapshot;
  const saved = (await (
    await request.post("/api/report-instances", { data: report })
  ).json()) as ReportInstance;
  expect(
    (await request.delete(templateUrl(draft.id, draft.version))).status(),
  ).toBe(204);

  const context = await browser.newContext({
    viewport: { width: 900, height: 1120 },
  });
  await context.addInitScript(({ key, id }) => localStorage.setItem(key, id), {
    key: reportKey,
    id: saved.id,
  });
  const warnings: string[] = [];
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator(".topbar")).toContainText("Report Instance");
  await expect(page.getByTestId(marker.id)).toBeVisible();
  expect(warnings.join("\n")).toContain(
    "source_template_missing_during_report_restore",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), reportKey),
  ).toBe(saved.id);
  await context.close();
});
