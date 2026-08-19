import type ExcelJSTypes from "exceljs";
import { calculateMarketTotals } from "../../report-engine/calculations/marketCalculations";
import type {
  IndustrialMarketReport,
  MarketMetrics,
  ProvenanceRecord,
  SubmarketMetrics,
} from "../../report-engine/schema/industrialMarketReport";
import type { ReportGenerationRequest } from "../../report-engine/schema/generation";
import type { ReportDataProvider } from "../ReportDataProvider";
import { ReportImportError } from "../ReportDataProvider";
import { q2SampleReport } from "../sample/q2SampleReport";

type ExcelConfiguration = { data: ArrayBuffer | Uint8Array; fileName?: string };
type CellValue = ExcelJSTypes.CellValue;
const metricColumns: { key: keyof MarketMetrics; header: string }[] = [
  { key: "inventorySf", header: "inventory (sf)" },
  { key: "deliveredSf", header: "delivered (sf)" },
  { key: "underConstructionSf", header: "under construction (sf)" },
  { key: "speculativeShare", header: "construction speculative (%)" },
  { key: "netAbsorptionSf", header: "net absorption (sf)" },
  { key: "vacancyRate", header: "total vacant (%)" },
  { key: "availabilityRate", header: "total available (%)" },
  { key: "askingNetRentPsf", header: "asking net rent ($/sf)" },
  { key: "salesVolume", header: "sales volume ($)" },
];

const scalarValue = (value: CellValue): unknown => {
  if (value && typeof value === "object") {
    if ("result" in value) return value.result;
    if ("richText" in value)
      return value.richText.map((run) => run.text).join("");
  }
  return value;
};
const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export class ExcelDataProvider implements ReportDataProvider {
  readonly id = "excel" as const;

  async loadReportData(
    request: ReportGenerationRequest,
  ): Promise<IndustrialMarketReport> {
    const config = request.source.configuration as
      Partial<ExcelConfiguration> | undefined;
    if (!config?.data)
      throw new ReportImportError("Import failed.", [
        "Choose the Submarket Stats workbook.",
      ]);

    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const bytes =
      config.data instanceof Uint8Array
        ? config.data
        : new Uint8Array(config.data);
    await workbook.xlsx.load(bytes as unknown as ExcelJSTypes.Buffer);
    const sheet =
      workbook.worksheets.find(
        (item) => clean(item.name) === "submarket table",
      ) ?? workbook.worksheets[0];
    if (!sheet)
      throw new ReportImportError("Import failed.", [
        "The workbook contains no worksheets.",
      ]);

    const headers = Array.from({ length: sheet.columnCount }, (_, index) =>
      clean(scalarValue(sheet.getCell(1, index + 1).value)),
    );
    const nameColumn = headers.indexOf("submarket") + 1;
    const indexes = metricColumns.map(
      (column) => headers.indexOf(column.header) + 1,
    );
    const missing = metricColumns
      .filter((_, index) => indexes[index] === 0)
      .map((column) => column.header);
    if (nameColumn === 0 || missing.length) {
      throw new ReportImportError("Import failed.", [
        `Missing columns: ${["submarket", ...missing].join(", ")}`,
      ]);
    }

    const importedAt = new Date().toISOString();
    const provenance: ProvenanceRecord[] = [];
    const submarkets: SubmarketMetrics[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const name = String(
        scalarValue(row.getCell(nameColumn).value) ?? "",
      ).trim();
      if (
        !name ||
        name.toUpperCase().startsWith("MARKET ") ||
        name.toUpperCase().startsWith("SUBMARKET ")
      )
        continue;
      const values = indexes.map((index) =>
        Number(scalarValue(row.getCell(index).value)),
      );
      if (values.some((value) => !Number.isFinite(value))) {
        throw new ReportImportError("Import failed.", [
          `${sheet.name} row ${rowNumber} contains a non-numeric metric.`,
        ]);
      }

      const metric = Object.fromEntries(
        metricColumns.map((column, index) => [column.key, values[index]]),
      ) as unknown as MarketMetrics;
      submarkets.push({ name, ...metric });
      metricColumns.forEach((column, index) =>
        provenance.push({
          fieldPath: `submarkets.${name}.${column.key}`,
          selectedValue: values[index],
          sources: [
            {
              sourceId: config.fileName ?? "excel-workbook",
              sourceType: "excel",
              value: values[index],
              reference: `${sheet.name}!${row.getCell(indexes[index]).address}`,
              importedAt,
            },
          ],
          authority: config.fileName ?? "Imported workbook",
          status: "matched",
        }),
      );
    }

    if (!submarkets.length)
      throw new ReportImportError("Import failed.", [
        "No submarket rows were found.",
      ]);
    const allowed = new Set(request.selectedSubmarkets ?? []);
    const selected = allowed.size
      ? submarkets.filter((item) => allowed.has(item.name))
      : submarkets;
    const base = structuredClone(q2SampleReport);
    return {
      ...base,
      report: {
        ...base.report,
        market: request.market,
        period: request.period,
        templateId: request.templateId,
      },
      submarkets: selected,
      overallMarket: {
        ...base.overallMarket,
        ...calculateMarketTotals(selected),
      },
      provenance: [
        ...provenance,
        ...base.provenance.filter(
          (record) => !record.fieldPath.startsWith("submarkets."),
        ),
      ],
    };
  }
}
