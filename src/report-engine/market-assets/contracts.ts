import { z } from "zod";
import type { ReportInstance } from "../schema/generation";
import type { ReportElement, ReportPage } from "../../types/report";

export const CATEGORIES = {
  charts: { label: "Charts", formats: ["png"], folder: "Charts" },
  indicators: {
    label: "Market Indicators",
    formats: ["png", "xlsx"],
    folder: "Market Indicators",
  },
  transactions: {
    label: "Top Leases & Sales",
    formats: ["png", "xlsx"],
    folder: "Top Leases and Sales",
  },
  statistics: {
    label: "Market Statistics",
    formats: ["xlsx"],
    folder: "Market Statistics",
  },
  narrative: {
    label: "Market Narrative",
    formats: ["docx"],
    folder: "Narrative",
  },
  section: {
    label: "Complete Market Section",
    formats: ["pdf"],
    folder: "Complete Section",
  },
  properties: {
    label: "Property Highlights",
    formats: ["png", "xlsx"],
    folder: "Property Highlights",
  },
  map: { label: "Submarket Map", formats: ["png"], folder: "Map" },
} as const;
export type Category = keyof typeof CATEGORIES;
export type Format = "png" | "xlsx" | "docx" | "pdf";
export const exportRequestSchema = z
  .object({
    reportId: z.string().regex(/^report-[a-zA-Z0-9-]+$/),
    markets: z.array(z.string().min(1).max(160)).min(1).max(100),
    categories: z
      .array(z.enum(Object.keys(CATEGORIES) as [Category, ...Category[]]))
      .min(1)
      .max(8),
    resolution: z.enum(["standard", "high"]).default("high"),
    transparent: z.boolean().default(false),
  })
  .strict();
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export const jobRequestSchema = exportRequestSchema.extend({
  revision: z.number().int().nonnegative(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export interface MarketSection {
  id: string;
  name: string;
  pages: ReportPage[];
  source: Record<string, unknown>;
}
export interface ExportAsset {
  id: string;
  marketId: string;
  market: string;
  category: Category;
  title: string;
  format: Format;
  page?: ReportPage;
  elements?: ReportElement[];
  text?: string;
  payload?: unknown;
  path: string;
  warnings: string[];
}
export interface ExportPlan {
  reportId: string;
  reportName: string;
  period: string;
  status: ReportInstance["status"];
  revision: number;
  snapshotHash: string;
  templateVersion: string;
  generatedAt: string;
  zipName: string;
  root: string;
  selectedMarkets: { id: string; name: string }[];
  categories: Category[];
  assets: ExportAsset[];
  warnings: string[];
  omissions?: { filename: string; reason: string }[];
}
export type JobState =
  | "queued"
  | "validating"
  | "rendering"
  | "packaging"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "canceled";
export interface ExportJob {
  id: string;
  state: JobState;
  createdAt: string;
  expiresAt: string;
  reportName: string;
  zipName: string;
  completed: number;
  total: number;
  current?: string;
  warnings: string[];
  error?: string;
  manifest?: ExportManifest;
}
export interface ExportManifest {
  schemaVersion: "1.0";
  exportedAt: string;
  reportName: string;
  reportId: string;
  reportingPeriod: string;
  revision: number;
  snapshotHash: string;
  sourceSnapshotHash?: string;
  templateVersion: string;
  templateChecksum: string;
  generatedAt: string;
  selectedMarkets: { id: string; name: string }[];
  selectedCategories: Category[];
  files: {
    filename: string;
    market: string;
    category: Category;
    format: Format;
    checksum: string;
    bytes: number;
    warnings: string[];
  }[];
  omissions: { filename: string; reason: string }[];
  warnings: string[];
  status: "completed" | "completed_with_warnings";
}
