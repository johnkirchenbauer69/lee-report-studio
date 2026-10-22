import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { CHICAGO_SUBMARKETS } from "../src/report-engine/submarkets.ts";
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error("Supply frozen display-layer directory and a new installation directory");
const bytes = await readFile(path.join(source, "display-manifest.json"));
const manifest = JSON.parse(bytes.toString("utf8")) as { market: string; layer: string; displaySha256: string }[];
const layers = ["boundary", "primary", "secondary", "local", "water", "municipalities", "parks"];
const verified: { relative: string; checksum: string }[] = [];
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
for (const market of CHICAGO_SUBMARKETS) for (const layer of layers) {
  const matches = manifest.filter(entry => entry.market === market.id && entry.layer === layer);
  if (matches.length !== 1) throw new Error(`Incomplete or duplicate layer: ${market.id}/${layer}`);
  const relative = path.join(market.id, `${layer}.${layer === "boundary" ? "json" : "geojson"}`);
  if (hash(await readFile(path.join(source, relative))) !== matches[0]!.displaySha256) throw new Error(`Source checksum mismatch: ${relative}`);
  verified.push({ relative, checksum: matches[0]!.displaySha256 });
}
await mkdir(destination, { recursive: false });
for (const market of CHICAGO_SUBMARKETS) await mkdir(path.join(destination, market.id));
for (const entry of verified) {
  const content = await readFile(path.join(source, entry.relative));
  if (hash(content) !== entry.checksum) throw new Error("Source changed during copy");
  await writeFile(path.join(destination, entry.relative), content, { flag: "wx" });
  if (hash(await readFile(path.join(destination, entry.relative))) !== entry.checksum) throw new Error("Copy readback mismatch");
}
// Publishing the manifest last makes partial copies unavailable to report generation.
await writeFile(path.join(destination, "display-manifest.json"), bytes, { flag: "wx" });
console.log(JSON.stringify({ status: "installed", markets: CHICAGO_SUBMARKETS.length, verifiedFiles: verified.length, manifestSha256: hash(bytes) }));
