import { readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import process from "node:process";

const root = process.cwd();
const violations = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
    const normalized = relative(root, path).split(sep).join("/");
    if (normalized.startsWith("src/") && /\.spec\.(ts|tsx)$/.test(normalized)) {
      violations.push(
        `${normalized}: Playwright specs must live under tests/visual/.`,
      );
    }
    if (
      normalized.startsWith("tests/visual/") &&
      /\.test\.(ts|tsx)$/.test(normalized)
    ) {
      violations.push(`${normalized}: Vitest tests must live under src/.`);
    }
  }
}

await visit(join(root, "src"));
await visit(join(root, "tests", "visual"));

if (violations.length) {
  console.error(
    `Test ownership violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(
  "Test ownership contract passed: src/**/*.test.* → Vitest; tests/visual/**/*.spec.* → Playwright.",
);
