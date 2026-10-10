import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  unlink,
  rename,
  stat,
} from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function files(root) {
  const result = [];
  for (const e of await readdir(root, { withFileTypes: true }).catch((e) => {
    if (e.code === "ENOENT") return [];
    throw e;
  })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) result.push(...(await files(p)));
    else if (e.isFile()) result.push(p);
  }
  return result;
}
export async function cleanLegacyReports({
  dataRoot,
  keepId,
  expectedHash,
  backupRoot,
}) {
  dataRoot = path.resolve(dataRoot);
  backupRoot = path.resolve(backupRoot);
  if (
    !/^report-[a-zA-Z0-9-]+$/.test(keepId) ||
    !/^[a-f0-9]{64}$/.test(expectedHash)
  )
    throw Error("Exact retained ID and SHA256 are required.");
  if (backupRoot === dataRoot || backupRoot.startsWith(dataRoot + path.sep))
    throw Error("Backup must be outside active storage.");
  const root = path.join(dataRoot, "report-instances"),
    records = [];
  for (const p of await files(root)) {
    if (
      !/^report-[a-zA-Z0-9-]+\.json$/.test(path.basename(p)) ||
      path.dirname(p) !== root
    )
      continue;
    const bytes = await readFile(p),
      record = JSON.parse(bytes);
    if (record.id + ".json" !== path.basename(p))
      throw Error("Report identity mismatch.");
    records.push({
      id: record.id,
      file: p,
      hash: hash(bytes),
      record,
      mtime: (await stat(p)).mtime.toISOString(),
    });
  }
  const keep = records.find((r) => r.id === keepId);
  if (!keep || keep.hash !== expectedHash)
    throw Error("Retained report fingerprint changed.");
  const matches = records.filter(
    (r) =>
      r.record.status === "published" &&
      r.record.generationRequest.period === "2026 Q3" &&
      r.record.templateVersion === "1.20.0",
  );
  if (matches.length !== 1 || matches[0].id !== keepId)
    throw Error(
      "The retained report must be the unique published Q3 2026 v1.20.0 edition.",
    );
  const deleted = records.filter((r) => r.id !== keepId);
  await mkdir(backupRoot, { recursive: false });
  // Back up every dependency, including shared assets; none are reclaimed.
  const backupFiles = [
    ...records.map((r) => r.file),
    ...(await files(path.join(dataRoot, "report-instance-assets"))),
    ...(await files(path.join(dataRoot, "assets"))),
    ...(await files(path.join(dataRoot, "templates"))),
  ];
  for (const name of ["assets.json", "salesforceImages.json"]) {
    const p = path.join(dataRoot, name);
    if (await stat(p).catch(() => null)) backupFiles.push(p);
  }
  const manifest = [];
  for (const p of backupFiles) {
    const rel = path.relative(dataRoot, p),
      target = path.join(backupRoot, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(p, target);
    const fingerprint = hash(await readFile(p));
    if (hash(await readFile(target)) !== fingerprint)
      throw Error("Unreadable or mismatched backup: " + rel);
    manifest.push({ path: rel, sha256: fingerprint });
  }
  // Inventory cross-record references without changing export jobs or templates.
  const references = [];
  for (const p of await files(dataRoot)) {
    if (path.extname(p) !== ".json" || p.startsWith(root + path.sep)) continue;
    const text = await readFile(p, "utf8");
    const ids = records.filter((r) => text.includes(r.id)).map((r) => r.id);
    if (ids.length)
      references.push({ path: path.relative(dataRoot, p), reportIds: ids });
  }
  const inventory = {
    createdAt: new Date().toISOString(),
    retained: {
      id: keep.id,
      sha256: keep.hash,
      revision: keep.record.revision,
      modifiedAt: keep.mtime,
      templateVersion: keep.record.templateVersion,
      period: keep.record.generationRequest.period,
      status: keep.record.status,
      snapshotHash: keep.record.sourceSnapshotHash,
      fontReferences: keep.record.fontReferences,
      presentationAssets: keep.record.presentationAssets,
    },
    deleted: deleted.map((r) => ({
      id: r.id,
      sha256: r.hash,
      path: path.relative(dataRoot, r.file),
    })),
    references,
    backupFiles: manifest,
    assetsRemoved: 0,
  };
  await writeFile(
    path.join(backupRoot, "manifest.json"),
    JSON.stringify(inventory, null, 2),
  );
  // Revalidate every affected file after backup and before the first deletion.
  for (const r of records)
    if (hash(await readFile(r.file)) !== r.hash)
      throw Error("Report changed during backup: " + r.id);
  const tombstone = path.join(dataRoot, "deleted-report-instances.json");
  const previous = JSON.parse(
    await readFile(tombstone, "utf8").catch((e) => {
      if (e.code === "ENOENT") return '{"ids":[]}';
      throw e;
    }),
  );
  await writeFile(
    tombstone + ".tmp",
    JSON.stringify(
      {
        ids: [...new Set([...previous.ids, ...deleted.map((r) => r.id)])],
        backupRoot,
        deletedAt: inventory.createdAt,
      },
      null,
      2,
    ),
  );
  await rename(tombstone + ".tmp", tombstone);
  for (const r of deleted) await unlink(r.file);
  const remaining = (await readdir(root)).filter((n) =>
    /^report-[a-zA-Z0-9-]+\.json$/.test(n),
  );
  if (
    remaining.length !== 1 ||
    remaining[0] !== keepId + ".json" ||
    hash(await readFile(keep.file)) !== expectedHash
  )
    throw Error("Cleanup readback failed.");
  for (const f of manifest.filter(
    (f) => !f.path.startsWith("report-instances" + path.sep),
  ))
    if (hash(await readFile(path.join(dataRoot, f.path))) !== f.sha256)
      throw Error("Shared dependency changed: " + f.path);
  await writeFile(
    path.join(backupRoot, "result.json"),
    JSON.stringify(
      {
        retainedId: keepId,
        deletedIds: deleted.map((r) => r.id),
        remaining: 1,
        retainedUnchanged: true,
        dependenciesUnchanged: true,
      },
      null,
      2,
    ),
  );
  return { retainedId: keepId, deletedCount: deleted.length, backupRoot };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const get = (k) => args[args.indexOf(k) + 1];
  if (
    !args.includes("--execute") ||
    !["--data-root", "--keep", "--expected-sha256", "--backup"].every((k) =>
      args.includes(k),
    )
  )
    throw Error(
      "Requires --execute --data-root --keep --expected-sha256 --backup. Stop the API before running.",
    );
  const endpoint = new URL(
    get("--api-url") || "http://127.0.0.1:8787/api/health",
  );
  await new Promise((resolve, reject) => {
    const socket = net.connect({
      host: endpoint.hostname,
      port: Number(endpoint.port || 80),
    });
    socket.setTimeout(2000);
    socket.once("connect", () => {
      socket.destroy();
      reject(Error("Stop the application API before cleanup."));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(Error("Cannot establish that the application API is stopped."));
    });
    socket.once("error", (e) => {
      socket.destroy();
      if (e.code === "ECONNREFUSED") resolve();
      else reject(e);
    });
  });
  console.log(
    JSON.stringify(
      await cleanLegacyReports({
        dataRoot: get("--data-root"),
        keepId: get("--keep"),
        expectedHash: get("--expected-sha256"),
        backupRoot: get("--backup"),
      }),
    ),
  );
}
