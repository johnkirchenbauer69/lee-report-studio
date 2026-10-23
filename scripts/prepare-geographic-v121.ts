import { FileSystemTemplateRepository } from "../server/templates/FileSystemTemplateRepository.ts";
import { geographicV121Template } from "../server/templates/geographicV121.ts";
const repository = new FileSystemTemplateRepository(process.argv[2] ?? "server/data");
const source = await repository.get("industrial-market-geographic", "1.2.0");
if (!source || source.checksum !== "d85816c713c9dc52ad9594aa0eea912380149b2ee69e3ccf1b72e5547a5489de")
  throw Error("Approved Geographic v1.2.0 source differs; inspect before preparing an edition");
const existing = await repository.get(source.id, "1.2.1");
if (existing) throw Error("Geographic v1.2.1 already exists; preserve its current state");
const edition = await repository.createVersion(source.id, source.version, geographicV121Template(source.template), { version: "1.2.1" });
console.log(JSON.stringify({ id: edition.id, version: edition.version, status: edition.status, checksum: edition.checksum }));
