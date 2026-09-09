import type { ManualOverride } from "../report-engine/schema/generation";
import type { ReportTemplate } from "../types/report";

const clone = <T>(value: T): T => structuredClone(value);

export interface EditorHistorySnapshot {
  template: ReportTemplate;
  manualOverrides: ManualOverride[];
}

export const captureEditorHistory = (
  template: ReportTemplate,
  manualOverrides: ManualOverride[],
): EditorHistorySnapshot => ({
  template: clone(template),
  manualOverrides: clone(manualOverrides),
});

export const upsertManualOverride = (
  current: ManualOverride[],
  input: Omit<ManualOverride, "createdAt">,
  createdAt = new Date().toISOString(),
) => {
  const matches = (item: ManualOverride) =>
    item.elementId === input.elementId &&
    item.bindingPath === input.bindingPath;
  const withoutElement = current.filter((item) => !matches(item));
  if (String(input.overrideValue ?? "") === String(input.generatedValue ?? ""))
    return withoutElement;
  const existing = current.find(matches);
  return [
    ...withoutElement,
    {
      ...input,
      createdAt: existing?.createdAt ?? createdAt,
    },
  ];
};
