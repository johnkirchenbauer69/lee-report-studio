import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fromBuffer } from "yauzl";

const metadata = JSON.parse(
  await fs.readFile("tests/fixtures/fonts/private-bundle.json", "utf8"),
);
const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp)
  throw new Error("RUNNER_TEMP is required for private font fixtures.");
const root = path.resolve(runnerTemp, "lee-ci-font-fixtures");
const parts = path.resolve(runnerTemp, "lee-ci-font-parts");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (process.argv[2] === "cleanup") {
  for (const directory of [root, parts]) {
    if (!directory.startsWith(path.resolve(runnerTemp) + path.sep))
      throw new Error("Unsafe private fixture cleanup path.");
    await fs.rm(directory, { recursive: true, force: true });
  }
} else if (process.argv[2] === "append") {
  const group = Number(process.argv[3]);
  if (
    !Number.isInteger(group) ||
    group < 0 ||
    group >= Math.ceil(metadata.chunkCount / 10)
  )
    throw new Error("Invalid private font secret group.");
  await fs.mkdir(parts, { recursive: true, mode: 0o700 });
  for (
    let index = group * 10 + 1;
    index <= Math.min((group + 1) * 10, metadata.chunkCount);
    index++
  ) {
    const key = `LEE_FONT_FIXTURE_${String(index).padStart(2, "0")}`;
    const value = process.env[key];
    if (
      !value ||
      value.length > metadata.chunkSize ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
    )
      throw new Error(
        `Missing or invalid private font secret ${key}. Provision licensed fixtures; do not skip font tests.`,
      );
    await fs.writeFile(path.join(parts, String(index)), value, {
      mode: 0o600,
      flag: "wx",
    });
  }
} else if (process.argv[2] === "restore") {
  const encoded = (
    await Promise.all(
      Array.from({ length: metadata.chunkCount }, (_, index) =>
        fs.readFile(path.join(parts, String(index + 1)), "utf8"),
      ),
    )
  ).join("");
  const bytes = Buffer.from(encoded, "base64");
  if (digest(bytes) !== metadata.sha256)
    throw new Error("Private font bundle checksum mismatch.");
  const entries = await new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const files = new Map();
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        if (
          files.has(entry.fileName) ||
          /(^|\/)\.\.?(\/|$)|\\|^\//.test(entry.fileName) ||
          entry.uncompressedSize > 2_000_000
        ) {
          zip.close();
          return reject(new Error("Unsafe private font ZIP entry."));
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(files));
      zip.readEntry();
    });
  });
  const fonts = JSON.parse(
    entries.get("assets.json")?.toString("utf8") ?? "null",
  );
  if (
    !Array.isArray(fonts) ||
    fonts.length !== metadata.fontCount ||
    entries.size !== fonts.length + 1
  )
    throw new Error("Private font inventory mismatch.");
  // Validate the entire bundle before writing any fixture files.
  for (const font of fonts) {
    if (
      font.type !== "font" ||
      font.fontGovernanceStatus !== "approved" ||
      !font.license ||
      !font.fontFamily?.startsWith("Avenir") ||
      !/^fonts\/organization\/[a-f0-9]{64}\.ttf$/.test(font.storageKey) ||
      digest(entries.get(`assets/${font.storageKey}`) ?? Buffer.alloc(0)) !==
        font.checksum
    )
      throw new Error("Private font asset validation failed.");
  }
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  for (const [name, content] of entries) {
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep))
      throw new Error("Unsafe private font destination.");
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, content, { mode: 0o600, flag: "wx" });
  }
  // Only fixture location and count are logged; font bytes and secrets never are.
  console.log(
    `Restored ${fonts.length} checksum-verified private font faces into runner temporary storage.`,
  );
  if (process.env.GITHUB_ENV)
    await fs.appendFile(
      process.env.GITHUB_ENV,
      `PLAYWRIGHT_FONT_FIXTURE_ROOT=${root}\n`,
    );
} else throw new Error("Use append <group>, restore, or cleanup.");
