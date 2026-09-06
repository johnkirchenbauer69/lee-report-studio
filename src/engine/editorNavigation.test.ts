import { describe, expect, it } from "vitest";
import type { ReportTemplate } from "../types/report";
import {
  openedTemplateEditorState,
  savedTemplateEditorState,
} from "./editorNavigation";

const template: ReportTemplate = {
  id: "template",
  name: "Template",
  version: "1",
  pages: [
    {
      id: "first",
      name: "First",
      width: 100,
      height: 100,
      background: "#fff",
      elements: [],
    },
    {
      id: "working",
      name: "Working",
      width: 100,
      height: 100,
      background: "#fff",
      elements: [
        {
          id: "kept",
          type: "shape",
          name: "Kept",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          style: {},
        },
      ],
    },
  ],
};

describe("template editor navigation state", () => {
  it("opens a template on its first page with no stale selection", () => {
    expect(openedTemplateEditorState(template)).toEqual({
      pageId: "first",
      selectedIds: [],
    });
  });

  it("preserves page and valid selection after save/save-as/publish adoption", () => {
    expect(
      savedTemplateEditorState(template, "working", ["kept", "removed"]),
    ).toEqual({
      pageId: "working",
      selectedIds: ["kept"],
    });
  });
});
