/** Synthetic acceptance input only; never persisted to report storage or Salesforce. */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
const [source, output] = process.argv.slice(2);
if (!source || !output || source === output) throw Error("Supply preserved input and new synthetic output");
const report = JSON.parse(await readFile(source, "utf8"));
const template = (await new FileSystemTemplateRepository("server/data").get("industrial-market-geographic", "1.2.1"))!.template;
const data = structuredClone(report.dataSnapshot);
const kinds = ["For Lease", "For Sale", "For Sale & Lease", "lease", "sale", "no-url"];
for (const [index, kind] of kinds.entries()) {
  const detail = data.submarketDetails[index];
  const image = report.pages.flatMap((p: { elements: { id: string; src?: string }[] }) => p.elements).find((e: { id: string }) => e.id === "featured-photo")?.src ?? "";
  const property = { ...data.availabilities[0], image, address: "12345 North International Industrial Parkway, Woodridge, IL", sizeSf: 999000000 };
  detail.featuredAvailability = { status: "empty", reason: "Synthetic acceptance" };
  detail.featuredDeal = undefined;
  if (kind === "lease" || kind === "sale") detail.featuredDeal = { status: "selected", kind, property };
  else detail.featuredAvailability = { status: "selected", property, minimumDivisibleSf: 100000000,
    marketedMaximumSf: 999000000, marketingType: kind === "no-url" ? "For Lease" : kind,
    listingUrl: kind === "no-url" ? undefined : "https://example.com/listing" };
}
const pages = expandTemplatePages(template, buildPresentationModel(data)).filter(p => p.id.startsWith("submarket-overview-repeat")).slice(0, 6)
  .map((page, index) => ({ ...page, name: `Synthetic ${kinds[index]}` }));
await writeFile(output, JSON.stringify({ ...report, dataSnapshot: data, id: randomUUID(), title: "SYNTHETIC card acceptance only", pages }), { flag: "wx" });
console.log(output);
