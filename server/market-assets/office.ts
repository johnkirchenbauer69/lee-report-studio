import ExcelJS from "exceljs";
import { ZipFile } from "yazl";
import type {
  ExportAsset,
  ExportPlan,
} from "../../src/report-engine/market-assets/contracts.ts";

type Cell = {
  value: string | number | null;
  format: string;
  current?: boolean;
};
type Table = { title: string; headers: string[]; rows: Cell[][] };
const numberFormat = (format: string) =>
  ({
    percentage: "0.00%;[Red]-0.00%;0.00%",
    percent: "0.00%",
    currency: "$#,##0;[Red]-$#,##0;$0",
    currency_psf: "$0.00;[Red]-$0.00;$0.00",
    decimal: "#,##0.00;[Red]-#,##0.00;0.00",
    integer: "#,##0;[Red]-#,##0;0",
  })[format] ?? "@";
const label = (key: string) => {
  const unit = key.endsWith("Psf")
    ? " (USD/SF)"
    : key.endsWith("Sf")
      ? " (SF)"
      : key.endsWith("Volume")
        ? " (USD)"
        : "";
  const words = key
    .replace(/Psf$|Sf$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^trailing12/, "Trailing 12");
  return words[0].toUpperCase() + words.slice(1) + unit;
};
const metricFormat = (key: string) =>
  /Rate|Share/.test(key)
    ? "percentage"
    : /Psf/.test(key)
      ? "currency_psf"
      : /Volume/.test(key)
        ? "currency"
        : "integer";
function table(
  sheet: ExcelJS.Worksheet,
  data: Table,
  start: number,
  tableId: string,
) {
  sheet.mergeCells(start, 1, start, data.headers.length);
  const title = sheet.getCell(start, 1);
  title.value = data.title;
  title.font = {
    name: "Calibri",
    size: 13,
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4E131E" },
  };
  sheet.getRow(start).height = 26;
  if (!data.rows.length) {
    sheet.mergeCells(start + 1, 1, start + 1, data.headers.length);
    sheet.getCell(start + 1, 1).value =
      "No qualifying records in this saved report.";
    sheet.getRow(start + 1).height = 26;
    return start + 4;
  }
  sheet.addTable({
    name: tableId,
    ref: `A${start + 1}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: data.headers.map((name) => ({ name, filterButton: true })),
    rows: data.rows.map((row) => row.map((c) => c.value)),
  });
  const header = sheet.getRow(start + 1);
  header.height = 32;
  header.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF182D46" },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  data.rows.forEach((row, i) => {
    sheet.getRow(start + 2 + i).height = 32;
    row.forEach((entry, j) => {
      const cell = sheet.getCell(start + 2 + i, j + 1);
      cell.value = entry.value;
      cell.numFmt =
        typeof entry.value === "number" ? numberFormat(entry.format) : "@";
      cell.font = {
        name: "Calibri",
        size: 10,
        bold: !!entry.current,
        color: { argb: "FF182D46" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: i % 2 ? "FFF2F4F5" : "FFFFFFFF" },
      };
      cell.alignment = {
        vertical: "middle",
        wrapText: true,
        horizontal: typeof entry.value === "number" ? "right" : "left",
      };
    });
  });
  data.headers.forEach((_, j) => {
    sheet.getColumn(j + 1).width =
      j === 0
        ? 33
        : Math.min(
            55,
            Math.max(
              20,
              ...data.rows.map((r) =>
                typeof r[j]?.value === "string"
                  ? String(r[j].value).length * 0.8
                  : 20,
              ),
            ),
          );
  });
  return start + data.rows.length + 5;
}
export async function writeWorkbook(
  asset: ExportAsset,
  plan: ExportPlan,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LEE Report Studio";
  workbook.created = new Date(plan.generatedAt);
  workbook.modified = workbook.created;
  const sheet = (name: string, columns = 6) => {
    const s = workbook.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 5 }],
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
      properties: { defaultRowHeight: 22 },
    });
    s.mergeCells(1, 1, 1, columns);
    s.getCell("A1").value = `${asset.market} ${asset.title}`;
    s.getCell("A1").font = {
      name: "Calibri",
      size: 16,
      bold: true,
      color: { argb: "FF4E131E" },
    };
    s.getRow(1).height = 44;
    s.getCell("A1").alignment = { vertical: "middle", wrapText: true };
    s.mergeCells(2, 1, 2, columns);
    s.getCell("A2").value =
      `${plan.period} · ${plan.status.toUpperCase()} · Saved ${plan.generatedAt.slice(0, 10)}`;
    s.getCell("A2").font = {
      name: "Calibri",
      size: 10,
      color: { argb: "FF182D46" },
    };
    s.getCell("A2").alignment = { wrapText: true, vertical: "middle" };
    s.getRow(2).height = 32;
    s.views[0].showGridLines = false;
    s.headerFooter.oddFooter = `${plan.reportName.replace(/&/g, "&&")} | ${plan.period} &RPage &P`;
    s.pageSetup.printTitlesRow = "1:2";
    return s;
  };
  if (asset.category === "indicators")
    table(
      sheet("Market Indicators"),
      asset.payload as Table,
      4,
      "MarketIndicators",
    );
  else if (asset.category === "transactions") {
    const tables = asset.payload as Table[];
    for (const [title, name, pattern] of [
      ["Top Leases", "TopLeases", /lease/i],
      ["Top Sales", "TopSales", /sale/i],
    ] as const) {
      table(
        sheet(name, 4),
        {
          ...(tables.find((t) => pattern.test(t.title)) ?? {
            headers: ["Party", "Amount", "Address", "Type"],
            rows: [],
          }),
          title,
        },
        4,
        name,
      );
    }
  } else if (asset.category === "properties") {
    const s = sheet("Property Highlights", 3);
    let start = 4;
    for (const [index, group] of (
      asset.payload as {
        title: string;
        rows: { address: string; sizeSf: number; detail: string }[];
      }[]
    ).entries()) {
      start = table(
        s,
        {
          title: group.title,
          headers: ["Property", "Size (SF)", "Details"],
          rows: group.rows.map((r) => [
            { value: r.address, format: "text" },
            { value: r.sizeSf, format: "integer" },
            { value: r.detail, format: "text" },
          ]),
        },
        start,
        `PropertyGroup${index + 1}`,
      );
    }
  } else {
    const payload = asset.payload as {
      metrics: [string, number][];
      periods: Record<string, unknown>[];
    };
    table(
      sheet("Current Statistics", 2),
      {
        title: `Current Quarter ${plan.period}`,
        headers: ["Metric", "Value"],
        rows: payload.metrics.map(([key, value]) => [
          { value: label(key), format: "text" },
          { value, format: metricFormat(key), current: true },
        ]),
      },
      4,
      "CurrentStatistics",
    );
    if (payload.periods.length) {
      const keys = [
        ...new Set(
          payload.periods.flatMap((p) =>
            Object.keys(p).filter(
              (k) =>
                k !== "period" && (typeof p[k] === "number" || p[k] === null),
            ),
          ),
        ),
      ];
      table(
        sheet("Historical Statistics", payload.periods.length + 1),
        {
          title: "Saved Historical Statistics",
          headers: ["Metric", ...payload.periods.map((p) => String(p.period))],
          rows: keys.map((key) => [
            { value: label(key), format: "text" },
            ...payload.periods.map((p, i) => ({
              value: (p[key] as number | null) ?? null,
              format: metricFormat(key),
              current: i === 0,
            })),
          ]),
        },
        4,
        "HistoricalStatistics",
      );
    }
  }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes as any);
  if (reopened.worksheets.length !== workbook.worksheets.length)
    throw new Error("Workbook validation failed.");
  for (const original of workbook.worksheets)
    original.eachRow((row) =>
      row.eachCell((cell) => {
        const saved = reopened
          .getWorksheet(original.name)!
          .getCell(cell.address);
        if (
          saved.value !== cell.value ||
          (typeof cell.value === "number" && saved.numFmt !== cell.numFmt)
        )
          throw new Error("Workbook value/number-format validation failed.");
        if (typeof saved.value === "object" && saved.value !== null)
          throw new Error("Workbook contains unsupported formulas or links.");
      }),
    );
  return bytes;
}
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export async function writeNarrative(
  asset: ExportAsset,
  plan: ExportPlan,
): Promise<Buffer> {
  // Exact native text paragraphs; no rewriting and no invented rich-text spans.
  const paragraph = (text: string, style: string) =>
    `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  const body =
    paragraph(`${asset.market} Industrial Market Narrative`, "Title") +
    paragraph(plan.period, "Subtitle") +
    asset
      .text!.split(/\r\n|\n|\r/)
      .map((t) => paragraph(t, "Normal"))
      .join("");
  const zip = new ZipFile();
  const parts: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:bottom="1080" w:left="1080" w:right="1080"/></w:sectPr></w:body></w:document>`,
    "word/styles.xml":
      '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="182D46"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="4E131E"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="280"/><w:keepNext/></w:pPr></w:style></w:styles>',
  };
  for (const [name, text] of Object.entries(parts))
    zip.addBuffer(Buffer.from(text, "utf8"), name);
  const result = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  zip.end();
  return result;
}
