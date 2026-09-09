import type { StoredTemplateVersion } from "../types/templateLibrary";

export type EditorDocumentMode = "master-template" | "report-instance";

/**
 * The one document-mutation policy used by canvas, inspector, keyboard,
 * history, and asset actions. Selection and preview remain outside it.
 */
export function canMutateDocument(input: {
  mode: EditorDocumentMode;
  templateStatus?: StoredTemplateVersion["status"];
}) {
  if (input.mode === "report-instance") return true;
  return input.templateStatus === undefined || input.templateStatus === "draft";
}
