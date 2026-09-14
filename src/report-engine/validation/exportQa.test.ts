import { describe, expect, it } from "vitest";
import { assessExportQa } from "./exportQa";

describe("assessExportQa", () => {
  it("keeps technical preflight errors blocking while making readiness advisory", () => {
    const result = assessExportQa(
      [
        {
          level: "error",
          kind: "structure",
          pageId: "page-1",
          message: "Page has invalid dimensions.",
        },
      ],
      [
        {
          level: "blocking",
          category: "data",
          message: "Narrative is missing.",
        },
      ],
    );

    expect(result.blockers).toHaveLength(1);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        level: "warning",
        message: "Narrative is missing.",
      }),
    ]);
  });

  it("deduplicates warnings so the confirmation count is exact", () => {
    const warning = {
      level: "warning" as const,
      kind: "overflow" as const,
      pageId: "page-1",
      elementId: "shape-1",
      message: "Shape extends outside Page 1.",
    };
    const result = assessExportQa([warning, warning]);
    expect(result.warnings).toHaveLength(1);
  });

  it("does not count successful informational checks as warnings", () => {
    const result = assessExportQa(
      [],
      [
        { level: "ok", message: "All bindings resolved." },
        { level: "info", message: "Data snapshot is current." },
      ],
    );
    expect(result).toEqual({ blockers: [], warnings: [] });
  });

  it("allows zero-rent and missing-narrative findings to proceed as warnings", () => {
    const result = assessExportQa(
      [],
      [
        {
          level: "warning",
          category: "data",
          message: "Asking rent is zero and should be reviewed.",
        },
        {
          level: "blocking",
          category: "data",
          message: "Narrative is missing.",
        },
      ],
    );
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });
});
