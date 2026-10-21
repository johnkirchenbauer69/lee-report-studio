import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";
import { classicFamilyTemplate, APPROVED_CLASSIC_SOURCE } from "../server/templates/canonicalFamilies.ts";
import { geographicFamilyTemplate } from "../server/templates/geographicFamily.ts";
import { normalizeReportTemplateFonts } from "../src/services/templateNormalization.ts";

const [root, backupDirectory] = process.argv.slice(2);
if (!root || !backupDirectory) throw new Error("Supply the data directory and a new backup directory. Creates drafts only.");
const repository = new FileSystemTemplateRepository(root);
const before = await repository.listAll();
const source = before.find(item => item.id === APPROVED_CLASSIC_SOURCE.id && item.version === APPROVED_CLASSIC_SOURCE.version);
if (!source) throw new Error("Approved source not found");
const classic = classicFamilyTemplate(source);
const geographic = geographicFamilyTemplate(classic);
const families = [classic, normalizeReportTemplateFonts(geographic, geographic.assets ?? [])];
if (before.some(record => families.some(family => family.id === record.id))) throw new Error("Canonical family already exists; no records changed.");
const filename = path.join(root, "templates", "templates.json");
const bytes = await readFile(filename);
await mkdir(backupDirectory, { recursive: false });
await writeFile(path.join(backupDirectory, "templates.json"), bytes, { flag: "wx" });
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
if (hash(await readFile(filename)) !== hash(bytes)) throw new Error("Template library changed during preparation; retry from a fresh backup.");
const created = await repository.createFamilies(families);
const after = await repository.listAll();
for (const original of before) {
  const preserved = after.find(item => item.id === original.id && item.version === original.version);
  if (JSON.stringify(original) !== JSON.stringify(preserved)) throw new Error("Historical template preservation check failed");
}
await writeFile(path.join(backupDirectory, "installation.json"), JSON.stringify({ status: "drafts-only-not-published", previousSha256: hash(bytes),
  created: created.map(({ id, version, checksum }) => ({ id, version, checksum })), preservedRecords: before.length }, null, 2));
console.log(JSON.stringify(created.map(({ id, version, status }) => ({ id, version, status }))));
