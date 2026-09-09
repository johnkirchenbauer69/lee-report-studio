import { z } from "zod";
import { normalizeElementCorners } from "../../engine/corners";
import type { ReportElement } from "../../types/report";
import {
  narrativeClaimSchema,
  narrativeQualityFlagSchema,
  narrativeStatusSchema,
} from "../narratives/schema";
import {
  industrialMarketReportSchema,
  datasetSectionSchema,
} from "./industrialMarketReport";
import {
  REPORT_INSTANCE_SCHEMA_VERSION,
  type ReportInstance,
} from "./generation";

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const nonEmpty = z.string().min(1);
const timestamp = nonEmpty;

const editorSettingsSchema = z
  .object({
    unit: z.enum(["px", "in"]),
    gridEnabled: z.boolean(),
    gridSpacingPx: finite.positive(),
    gridOpacity: finite.min(0).max(1),
    snapToGrid: z.boolean(),
    snapToElements: z.boolean(),
    snapToMargins: z.boolean(),
    marginPx: nonNegative,
    marginsEnabled: z.boolean(),
    rulersEnabled: z.boolean().optional(),
    customGuides: z
      .array(
        z
          .object({
            id: nonEmpty,
            axis: z.enum(["x", "y"]),
            position: finite,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const bindingSchema = z
  .object({
    path: nonEmpty,
    label: z.string().optional(),
    format: z
      .enum([
        "text",
        "percentage",
        "integer",
        "decimal",
        "sf",
        "currency",
        "currency_psf",
      ])
      .optional(),
    decimals: z.number().int().optional(),
    fallback: z.string().optional(),
  })
  .strict();

const bindingContextSchema = z
  .object({ name: nonEmpty, path: nonEmpty })
  .strict();
const repeatSchema = z
  .object({
    sourcePath: nonEmpty,
    contextName: z.string().optional(),
    direction: z.enum(["vertical", "horizontal"]).optional(),
    maximumItems: z.number().int().positive().optional(),
    spacing: finite.optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["ascending", "descending"]).optional(),
  })
  .strict();

const gradientStopSchema = z
  .object({
    id: nonEmpty,
    color: nonEmpty,
    position: finite,
  })
  .strict();
const fillSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: nonEmpty }).strict(),
  z
    .object({
      type: z.literal("linear-gradient"),
      angle: finite,
      stops: z.array(gradientStopSchema).min(1),
    })
    .strict(),
]);
const strokeSchema = z
  .object({
    enabled: z.boolean(),
    color: nonEmpty,
    width: nonNegative,
    opacity: finite.min(0).max(1),
    style: z.enum(["solid", "dashed", "dotted"]),
  })
  .strict();
const shadowSchema = z
  .object({
    enabled: z.boolean(),
    color: nonEmpty,
    offsetX: finite,
    offsetY: finite,
    blur: nonNegative,
    opacity: finite.min(0).max(1),
  })
  .strict();
const bevelSchema = z
  .object({
    enabled: z.boolean(),
    size: nonNegative,
    direction: z.enum(["raised", "inset"]),
    highlightColor: nonEmpty,
    highlightOpacity: finite.min(0).max(1),
    shadowColor: nonEmpty,
    shadowOpacity: finite.min(0).max(1),
  })
  .strict();
const cornerRadiiSchema = z
  .object({
    topLeft: nonNegative,
    topRight: nonNegative,
    bottomRight: nonNegative,
    bottomLeft: nonNegative,
    linked: z.boolean(),
  })
  .strict();
const typographySchema = z
  .object({
    fontFamily: nonEmpty,
    fontWeight: z.union([finite, nonEmpty]),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    fontAssetId: z.string().optional(),
    fontChecksum: z.string().optional(),
    fontSize: nonNegative,
    color: nonEmpty,
    letterSpacing: finite,
    lineHeight: finite.positive(),
    textAlign: z.enum(["left", "center", "right", "justify"]),
    verticalAlign: z.enum(["top", "middle", "bottom"]),
    italic: z.boolean(),
    underline: z.boolean(),
    uppercase: z.boolean().optional(),
  })
  .strict();
const elementStyleSchema = z
  .object({
    fontFamily: z.string().optional(),
    fontSize: finite.optional(),
    fontWeight: finite.optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    fontAssetId: z.string().optional(),
    fontChecksum: z.string().optional(),
    italic: z.boolean().optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    color: z.string().optional(),
    background: z.string().optional(),
    borderColor: z.string().optional(),
    borderWidth: nonNegative.optional(),
    borderRadius: nonNegative.optional(),
    cornerRadii: cornerRadiiSchema.optional(),
    padding: finite.optional(),
    opacity: finite.optional(),
    fill: fillSchema.optional(),
    stroke: strokeSchema.optional(),
    shadow: shadowSchema.optional(),
    bevel: bevelSchema.optional(),
    typography: typographySchema.optional(),
    letterSpacing: finite.optional(),
    lineHeight: finite.optional(),
    textDecoration: z.enum(["none", "underline"]).optional(),
    mixBlendMode: z.enum(["normal", "screen", "multiply"]).optional(),
  })
  .strict();

const baseElementShape = {
  id: nonEmpty,
  name: nonEmpty,
  x: finite,
  y: finite,
  width: nonNegative,
  height: nonNegative,
  rotation: finite.optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  allowOverflow: z.boolean().optional(),
  groupId: z.string().optional(),
  style: elementStyleSchema,
  binding: bindingSchema.optional(),
  bindingContext: bindingContextSchema.optional(),
  repeat: repeatSchema.optional(),
  requiredDataSection: datasetSectionSchema.optional(),
  unavailableMessage: z.string().optional(),
  publishedUnavailableMessage: z.string().optional(),
  publishedText: z.string().optional(),
};

const tableCellStyleSchema = z
  .object({
    fontFamily: z.string().optional(),
    fontWeight: finite.optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    fontAssetId: z.string().optional(),
    fontChecksum: z.string().optional(),
    fontSize: finite.optional(),
    color: z.string().optional(),
    background: z.string().optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    padding: finite.optional(),
    borderColor: z.string().optional(),
    borderWidth: nonNegative.optional(),
    shadow: shadowSchema.optional(),
  })
  .strict();
const tableColumnSchema = z
  .object({
    key: nonEmpty,
    label: z.string(),
    path: nonEmpty,
    format: bindingSchema.shape.format,
    decimals: z.number().int().optional(),
    width: nonNegative.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    headerStyle: tableCellStyleSchema.optional(),
    bodyStyle: tableCellStyleSchema.optional(),
  })
  .strict();
const chartSeriesSchema = z
  .object({
    id: nonEmpty,
    name: nonEmpty,
    valuePath: nonEmpty,
    type: z.enum(["bar", "line", "area", "column"]).optional(),
    color: nonEmpty,
    lineWidth: nonNegative.optional(),
    markerSize: nonNegative.optional(),
    axisId: z.string().optional(),
  })
  .strict();
const chartAxisSchema = z
  .object({
    id: nonEmpty,
    position: z.enum(["left", "right", "bottom"]),
    title: z.string().optional(),
    minimum: finite.optional(),
    maximum: finite.optional(),
    format: bindingSchema.shape.format,
    decimals: z.number().int().optional(),
    showGridlines: z.boolean().optional(),
  })
  .strict();
const chartStyleSchema = z
  .object({
    background: z.string().optional(),
    gridColor: z.string().optional(),
    labelColor: z.string().optional(),
    fontFamily: z.string().optional(),
    fontWeight: finite.optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    fontAssetId: z.string().optional(),
    fontChecksum: z.string().optional(),
    fontSize: finite.optional(),
  })
  .strict();

export const reportElementSchema = z.discriminatedUnion("type", [
  z
    .object({ ...baseElementShape, type: z.literal("text"), text: z.string() })
    .strict(),
  z
    .object({
      ...baseElementShape,
      type: z.literal("shape"),
      shape: z
        .enum([
          "rectangle",
          "rounded-rectangle",
          "circle",
          "ellipse",
          "line",
          "triangle",
          "diamond",
          "path",
        ])
        .optional(),
      pathGeometry: z
        .object({
          rings: z
            .array(z.array(z.object({ x: finite, y: finite }).strict()).min(3))
            .min(1),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...baseElementShape,
      type: z.literal("image"),
      src: z.string(),
      fit: z.enum(["cover", "contain", "stretch", "original"]).optional(),
      assetId: z.string().optional(),
      crop: z
        .object({ x: finite, y: finite, zoom: finite.positive() })
        .strict()
        .optional(),
      sourceCrop: z
        .object({
          sourceWidth: finite.positive(),
          sourceHeight: finite.positive(),
          x: finite,
          y: finite,
          width: finite.positive(),
          height: finite.positive(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...baseElementShape,
      type: z.literal("table"),
      sourcePath: nonEmpty,
      columns: z.array(tableColumnSchema),
      maxRows: z.number().int().positive().optional(),
      variant: z
        .enum(["default", "market-matrix", "indicators", "transactions"])
        .optional(),
      rowKindPath: z.string().optional(),
      emptyMessage: z.string().optional(),
      rowHeight: nonNegative.optional(),
      headerStyle: tableCellStyleSchema.optional(),
      bodyStyle: tableCellStyleSchema.optional(),
      transactionChipStyle: tableCellStyleSchema.optional(),
      cellStyles: z.record(z.string(), tableCellStyleSchema).optional(),
    })
    .strict(),
  z
    .object({
      ...baseElementShape,
      type: z.literal("chart"),
      marketingChartId: z
        .enum([
          "availability_by_size",
          "net_absorption_vacancy_availability",
          "sales_volume_cap_rates",
          "construction_uc_deliveries",
        ])
        .optional(),
      sourcePath: nonEmpty,
      categoryPath: nonEmpty,
      valuePath: z.string().optional(),
      chartType: z.enum(["bar", "line", "area", "column", "combination"]),
      title: z.string().optional(),
      series: z.array(chartSeriesSchema).optional(),
      axes: z.array(chartAxisSchema).optional(),
      legend: z
        .object({
          visible: z.boolean(),
          position: z.enum(["top", "right", "bottom", "left"]),
        })
        .strict()
        .optional(),
      chartStyle: chartStyleSchema.optional(),
    })
    .strict(),
]);

export const reportPageSchema = z
  .object({
    id: nonEmpty,
    name: nonEmpty,
    width: finite.positive(),
    height: finite.positive(),
    background: nonEmpty,
    hidden: z.boolean().optional(),
    pageNumber: z.number().int().positive().optional(),
    bindingContext: bindingContextSchema.optional(),
    repeat: z
      .object({
        sourcePath: nonEmpty,
        contextName: nonEmpty,
        maximumItems: z.number().int().positive().optional(),
        sortBy: z.string().optional(),
        sortOrder: z.enum(["ascending", "descending"]).optional(),
      })
      .strict()
      .optional(),
    elements: z.array(reportElementSchema),
  })
  .strict();

const generationRequestSchema = z
  .object({
    templateId: nonEmpty,
    templateVersion: nonEmpty,
    templateChecksum: z.string().optional(),
    market: nonEmpty,
    period: nonEmpty,
    calculationScope: z.discriminatedUnion("type", [
      z.object({ type: z.literal("all-submarkets") }).strict(),
      z
        .object({
          type: z.literal("selected-submarkets"),
          submarkets: z.array(nonEmpty).min(1),
        })
        .strict(),
    ]),
    pageSelection: z
      .object({
        submarketIds: z.array(nonEmpty).optional(),
        submarkets: z.array(nonEmpty).optional(),
      })
      .strict(),
    source: z
      .object({
        provider: z.enum(["sample", "json", "excel", "ascendix"]),
        configuration: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

const narrativeRevisionSchema = z
  .object({
    id: nonEmpty,
    text: z.string(),
    source: z.enum(["ai", "manual"]),
    status: narrativeStatusSchema,
    timestamp,
    model: z.string().optional(),
    promptVersion: z.string().optional(),
    contextHash: z.string().optional(),
    regenerationInstruction: z.string().optional(),
    claims: z.array(narrativeClaimSchema),
    qualityFlags: z.array(narrativeQualityFlagSchema),
  })
  .strict();
const narrativeRecordSchema = z
  .object({
    marketId: nonEmpty,
    marketName: nonEmpty,
    marketKind: z.enum(["overall", "submarket"]),
    period: nonEmpty,
    text: z.string(),
    status: narrativeStatusSchema,
    source: z.enum(["ai", "manual"]),
    promptVersion: nonEmpty,
    model: z.string().optional(),
    contextHash: z.string().optional(),
    reportDataHash: z.string(),
    generatedAt: timestamp.optional(),
    editedAt: timestamp.optional(),
    approvedAt: timestamp.optional(),
    claims: z.array(narrativeClaimSchema),
    contextKeysUsed: z.array(z.string()),
    qualityFlags: z.array(narrativeQualityFlagSchema),
    revisions: z.array(narrativeRevisionSchema),
    regenerationInstruction: z.string().optional(),
    wordCount: z.number().int().nonnegative(),
    overflow: z.boolean(),
    error: z.string().optional(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const validationIssueSchema = z
  .object({
    path: nonEmpty,
    message: nonEmpty,
    level: z.enum(["info", "warning", "error", "blocking"]),
    category: z.enum(["data", "provenance", "readiness"]),
  })
  .strict();
const externalJobSchema = z
  .object({
    provider: z.literal("chatgpt_mcp"),
    jobId: nonEmpty,
    status: z.enum([
      "creating",
      "waiting_for_chatgpt",
      "complete",
      "failed",
      "expired",
    ]),
    createdAt: timestamp,
    updatedAt: timestamp,
    marketIds: z.array(nonEmpty).min(1),
    generationScope: z.enum(["all", "selected"]),
    appUrl: z.string().optional(),
    handoffPrompt: z.string().optional(),
    expiresAt: timestamp.optional(),
    importedAt: timestamp.optional(),
    error: z.string().optional(),
    instruction: z.string().optional(),
    contextHashes: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const manualOverrideSchema = z
  .object({
    elementId: nonEmpty,
    bindingPath: z.string().optional(),
    generatedValue: z.unknown(),
    overrideValue: z.unknown(),
    createdAt: timestamp,
  })
  .strict();

export const reportDocumentPatchSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    pages: z.array(reportPageSchema).min(1),
    manualOverrides: z.array(manualOverrideSchema),
  })
  .strict();

export const reportInstanceSchema = z
  .object({
    schemaVersion: z.literal(REPORT_INSTANCE_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    id: z.string().regex(/^report-[a-zA-Z0-9-]+$/),
    templateId: nonEmpty,
    templateVersion: nonEmpty,
    templateChecksum: nonEmpty,
    sourceTemplateSnapshot: z
      .object({
        name: nonEmpty,
        settings: editorSettingsSchema.optional(),
      })
      .strict()
      .optional(),
    generationRequest: generationRequestSchema,
    provider: z.enum(["sample", "json", "excel", "ascendix"]),
    sourceMetadata: z
      .object({
        importedAt: timestamp,
        sourceName: z.string().optional(),
        sourceVersion: z.string().optional(),
      })
      .strict(),
    sourceSnapshotId: z.string().optional(),
    sourceSnapshotHash: z.string().optional(),
    reportDefinitionVersion: z.string().optional(),
    generatedAt: timestamp,
    dataSnapshot: industrialMarketReportSchema,
    pages: z.array(reportPageSchema).min(1),
    fontReferences: z.array(
      z
        .object({
          assetId: nonEmpty,
          family: nonEmpty,
          weight: finite,
          style: z.enum(["normal", "italic"]),
          checksum: nonEmpty,
        })
        .strict(),
    ),
    manualOverrides: z.array(manualOverrideSchema),
    narratives: z.array(narrativeRecordSchema).length(19),
    externalNarrativeJob: externalJobSchema.optional(),
    readiness: z
      .object({
        canEdit: z.boolean(),
        canExportDraft: z.boolean(),
        canApprove: z.boolean(),
        canPublish: z.boolean(),
        blockers: z.array(validationIssueSchema),
        issues: z.array(validationIssueSchema),
      })
      .strict(),
    status: z.enum(["draft", "approved", "published"]),
  })
  .strict();

export class ReportInstanceValidationError extends Error {
  constructor(
    message: string,
    readonly issues?: z.core.$ZodIssue[],
  ) {
    super(message);
    this.name = "ReportInstanceValidationError";
  }
}

const validationMessage = (error: z.ZodError) =>
  error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "report"}: ${issue.message}`)
    .join("; ");

/** Normalize known legacy storage fields without inventing business data. */
export function normalizeReportInstance(input: unknown): ReportInstance {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ReportInstanceValidationError(
      "ReportInstance must be an object.",
    );
  const legacy = structuredClone(input) as Record<string, unknown>;
  if (legacy.schemaVersion === undefined)
    legacy.schemaVersion = REPORT_INSTANCE_SCHEMA_VERSION;
  if (legacy.revision === undefined) legacy.revision = 0;
  if (legacy.manualOverrides === undefined) legacy.manualOverrides = [];
  if (legacy.fontReferences === undefined) legacy.fontReferences = [];
  if (
    legacy.sourceMetadata &&
    typeof legacy.sourceMetadata === "object" &&
    !Array.isArray(legacy.sourceMetadata) &&
    !("importedAt" in legacy.sourceMetadata) &&
    typeof legacy.generatedAt === "string"
  )
    (legacy.sourceMetadata as Record<string, unknown>).importedAt =
      legacy.generatedAt;
  const parsed = reportInstanceSchema.safeParse(legacy);
  if (!parsed.success)
    throw new ReportInstanceValidationError(
      `Invalid ReportInstance: ${validationMessage(parsed.error)}`,
      parsed.error.issues,
    );
  const normalized: ReportInstance = {
    ...parsed.data,
    pages: parsed.data.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) =>
        normalizeElementCorners(element as ReportElement),
      ),
    })),
  };
  return reportInstanceSchema.parse(normalized) as ReportInstance;
}

export function serializeReportInstance(instance: ReportInstance) {
  return JSON.stringify(normalizeReportInstance(instance), null, 2);
}
