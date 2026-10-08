import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fromBuffer } from "yauzl";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import sharp from "sharp";

const root = process.argv[2] ?? "docs/evidence/market-assets";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function unzip(bytes) {
  return new Promise((resolve, reject) =>
    fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const entries = new Map();
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        if (
          entries.has(entry.fileName) ||
          /(^|\/)\.\.?(\/|$)|\\|^\//.test(entry.fileName)
        ) {
          zip.close();
          return reject(new Error("Unsafe or duplicate ZIP entry"));
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(entries));
      zip.readEntry();
    }),
  );
}
const results = [];
for (const name of (await fs.readdir(root)).filter((n) => n.endsWith(".zip"))) {
  const entries = await unzip(await fs.readFile(path.join(root, name)));
  const manifestEntry = [...entries].find(([name]) =>
    name.endsWith("/ExportManifest.json"),
  );
  if (!manifestEntry) throw new Error("Manifest missing");
  const manifest = JSON.parse(manifestEntry[1]);
  if (entries.size !== manifest.files.length + 1 || manifest.omissions.length)
    throw new Error(`${name}: incomplete inventory`);
  let worksheets = 0,
    pdfPages = 0,
    pngs = 0,
    docs = 0;
  for (const declared of manifest.files) {
    const bytes = entries.get(declared.filename);
    if (
      !bytes ||
      bytes.length !== declared.bytes ||
      digest(bytes) !== declared.checksum
    )
      throw new Error("Checksum mismatch");
    if (!/\.(png|xlsx|docx|pdf)$/.test(declared.filename))
      throw new Error("Unexpected file type");
    if (declared.format === "png") {
      const metadata = await sharp(bytes).metadata();
      if (![1200, 2400].includes(metadata.width) || !metadata.height)
        throw new Error("Incorrect PNG dimensions");
      pngs++;
    }
    if (declared.format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      worksheets += workbook.worksheets.length;
      const parts = await unzip(bytes);
      if ([...parts.keys()].some((k) => /vba|externalLinks/i.test(k)))
        throw new Error("Macros or external workbook links");
      for (const sheet of workbook.worksheets)
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            if (typeof cell.value === "object" && cell.value !== null)
              throw new Error("Formula/link found in snapshot-only workbook");
          }),
        );
      if (
        declared.category === "properties" &&
        workbook.worksheets.length !== 1
      )
        throw new Error("Property worksheet topology incorrect");
      if (
        declared.category === "properties" &&
        [...parts.keys()].filter((k) => /^xl\/tables\/table\d+\.xml$/.test(k))
          .length !== 3
      )
        throw new Error("Three property tables missing");
      if (
        declared.category === "transactions" &&
        workbook.worksheets.map((s) => s.name).join(",") !==
          "TopLeases,TopSales"
      )
        throw new Error("Transaction sheets incorrect");
      if (declared.category === "indicators") {
        let percentage = false,
          nulls = 0;
        workbook.worksheets[0].eachRow((row) =>
          row.eachCell({ includeEmpty: true }, (cell) => {
            if (cell.value === 0.0509 && cell.numFmt.includes("%"))
              percentage = true;
            if (cell.value === null) nulls++;
          }),
        );
        if (!percentage || !nulls)
          throw new Error("Synthetic fraction/null checks failed");
      }
    }
    if (declared.format === "docx") {
      const parts = await unzip(bytes),
        xml = parts.get("word/document.xml").toString();
      const paragraphs = [...xml.matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/gs)].map(
        (m) =>
          m[1]
            .replaceAll("&amp;", "&")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">"),
      );
      const expected = [
        "This is a synthetic export QA narrative. It is not market analysis.",
        "",
        "Saved paragraph two preserves punctuation, spacing, and order.",
      ];
      if (JSON.stringify(paragraphs.slice(2)) !== JSON.stringify(expected))
        throw new Error("Narrative text/order changed");
      if (
        [...parts.values()].some((v) =>
          v.toString().includes('TargetMode="External"'),
        ) ||
        [...parts.keys()].some((n) => /vba/i.test(n))
      )
        throw new Error("External document relationship");
      docs++;
    }
    if (declared.format === "pdf") {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      pdfPages += pdf.getPageCount();
      if (
        pdf.getPageCount() !== 2 ||
        pdf.getProducer() !== "LEE Report Studio Chromium renderer"
      )
        throw new Error("Unsupported PDF path or page count");
      const { text } = await extractText(new Uint8Array(bytes), {
        mergePages: true,
      });
      if (!text.includes("synthetic export QA narrative"))
        throw new Error("Section narrative missing");
    }
  }
  results.push({
    package: name,
    files: manifest.files.length,
    markets: manifest.selectedMarkets.length,
    pngs,
    worksheets,
    nativeDocuments: docs,
    pdfPages,
    checksums: "passed",
    omissions: manifest.omissions.length,
  });
}
await fs.writeFile(
  path.join(root, "artifact-validation.json"),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
