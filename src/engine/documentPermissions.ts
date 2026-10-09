import type { StoredTemplateVersion } from "../types/templateLibrary";

export type EditorDocumentMode = "master-template" | "report-instance";

/**
 * The one document-mutation policy used by canvas, inspector, keyboard,
 * history, and asset actions. Selection and preview remain outside it.
 */
export function canMutateDocument(input: {
  mode: EditorDocumentMode;
  templateStatus?: StoredTemplateVersion["status"];
  reportStatus?: "draft" | "approved" | "published";
}) {
  if (input.mode === "report-instance") return input.reportStatus !== "published";
  return input.templateStatus === undefined || input.templateStatus === "draft";
}
