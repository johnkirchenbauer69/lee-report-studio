import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Asset } from "../../src/types/report";

export async function seedVisualFixtures(apiUrl: string, dataRoot: string) {
  // This is invoked only after the production-data isolation guard has passed.
  const fixtureRoots = [
    path.resolve("tests/fixtures/fonts/open"),
    ...(process.env.PLAYWRIGHT_FONT_FIXTURE_ROOT
      ? [process.env.PLAYWRIGHT_FONT_FIXTURE_ROOT]
      : []),
  ];
  for (const fixtureRoot of fixtureRoots) {
    const sourceRoot = path.resolve(fixtureRoot);
    if (sourceRoot === path.resolve(dataRoot))
      throw new Error("Font fixture source must differ from test storage.");
    const source = JSON.parse(
      await readFile(path.join(sourceRoot, "assets.json"), "utf8"),
    ) as Asset[];
    const fonts = source.filter(
      (a) =>
        a.type === "font" &&
        a.fontGovernanceStatus === "approved" &&
        a.license &&
        a.storageKey,
    );
    for (const font of fonts) {
      const sourceFile = path.resolve(sourceRoot, "assets", font.storageKey!);
      const targetFile = path.resolve(dataRoot, "assets", font.storageKey!);
      if (
        !sourceFile.startsWith(path.join(sourceRoot, "assets") + path.sep) ||
        !targetFile.startsWith(path.join(dataRoot, "assets") + path.sep)
      )
        throw new Error("Unsafe font fixture path.");
      const bytes = await readFile(sourceFile);
      if (createHash("sha256").update(bytes).digest("hex") !== font.checksum)
        throw new Error("Font fixture checksum mismatch.");
      await mkdir(path.dirname(targetFile), { recursive: true });
      await copyFile(sourceFile, targetFile);
    }
    const manifest = path.join(dataRoot, "assets.json");
    const existing = JSON.parse(await readFile(manifest, "utf8")) as Asset[];
    await writeFile(
      manifest,
      JSON.stringify(
        [
          ...existing.filter((a) => !fonts.some((f) => f.id === a.id)),
          ...fonts,
        ],
        null,
        2,
      ),
    );
  }
  const base = apiUrl.replace("/api/health", "/api");
  // Deterministic, redistributable image choices for real replacement tests.
  for (const name of ["lee-icon.png", "lee-full-color.png"]) {
    const form = new FormData();
    form.append(
      "files",
      new Blob([await readFile(path.resolve("public/brand", name))], {
        type: "image/png",
      }),
      name,
    );
    const uploaded = await fetch(base + "/assets", {
      method: "POST",
      body: form,
    });
    if (!uploaded.ok) throw new Error("Visual image fixture import failed.");
  }
  const response = await fetch(base + "/templates");
  if (!response.ok)
    throw new Error("Visual template fixtures could not be read.");
  let versions = (await response.json()).templates as Array<{
    id: string;
    version: string;
  }>;
  const family = "industrial-market-report";
  // Legacy acceptance specs pin v1.8.0. Create it from the real seeded template,
  // rather than skipping the editor controls when a clean test store lacks it.
  while (!versions.some((v) => v.id === family && v.version === "1.8.0")) {
    const latest = versions
      .filter((v) => v.id === family)
      .sort(
        (a, b) =>
          Number(b.version.split(".")[1]) - Number(a.version.split(".")[1]),
      )[0];
    if (!latest || Number(latest.version.split(".")[1]) >= 8)
      throw new Error("Cannot seed the required v1.8.0 visual fixture.");
    const created = await fetch(
      `${base}/templates/${family}/versions/${latest.version}/new`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (!created.ok)
      throw new Error("Visual template fixture creation failed.");
    versions.push(await created.json());
  }
  const published = await fetch(
    `${base}/templates/${family}/versions/1.3.0/publish`,
    { method: "POST" },
  );
  if (!published.ok)
    throw new Error(
      "Visual published template fixture failed: " + (await published.text()),
    );
}
