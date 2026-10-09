import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
// @ts-expect-error Explicit offline maintenance entrypoint is JavaScript.
import { cleanLegacyReports } from "../../scripts/cleanup-legacy-reports.mjs";
it("backs up and deletes exact legacy records while preserving the retained bytes, templates and shared assets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lee-report-cleanup-"));
  try {
    const data = path.join(root, "data");
    await mkdir(path.join(data, "report-instances"), { recursive: true });
    await mkdir(path.join(data, "assets"));
    await mkdir(path.join(data, "templates"));
    const keep = {
      id: "report-keep",
      revision: 189,
      status: "published",
      templateVersion: "1.20.0",
      generationRequest: { period: "2026 Q3" },
      fontReferences: [],
    };
    const bytes = JSON.stringify(keep),
      sha = createHash("sha256").update(bytes).digest("hex");
    await writeFile(
      path.join(data, "report-instances/report-keep.json"),
      bytes,
    );
    await writeFile(
      path.join(data, "report-instances/report-old.json"),
      JSON.stringify({ ...keep, id: "report-old", status: "draft" }),
    );
    await writeFile(path.join(data, "assets/shared.png"), "shared");
    await writeFile(path.join(data, "templates/templates.json"), "[]");
    await expect(
      cleanLegacyReports({
        dataRoot: data,
        keepId: "report-keep",
        expectedHash: "0".repeat(64),
        backupRoot: path.join(root, "bad"),
      }),
    ).rejects.toThrow("fingerprint");
    expect((await readdir(path.join(data, "report-instances"))).length).toBe(2);
    const result = await cleanLegacyReports({
      dataRoot: data,
      keepId: "report-keep",
      expectedHash: sha,
      backupRoot: path.join(root, "backup"),
    });
    expect(result.deletedCount).toBe(1);
    expect(await readdir(path.join(data, "report-instances"))).toEqual([
      "report-keep.json",
    ]);
    expect(
      await readFile(
        path.join(data, "report-instances/report-keep.json"),
        "utf8",
      ),
    ).toBe(bytes);
    expect(
      await readFile(
        path.join(root, "backup/report-instances/report-old.json"),
        "utf8",
      ),
    ).toContain("report-old");
    expect(await readFile(path.join(data, "assets/shared.png"), "utf8")).toBe(
      "shared",
    );
    expect(
      JSON.parse(
        await readFile(
          path.join(data, "deleted-report-instances.json"),
          "utf8",
        ),
      ).ids,
    ).toEqual(["report-old"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
