import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { strict as assert } from "node:assert";
import ExcelJS from "exceljs";

// Independent comparisons against raw saved source fields, not exporter output.
const root = path.join(process.env.TEMP!, "lee-local-integration-20261008", "real-i55");
const report = JSON.parse(await readFile("server/data/report-instances/report-2e6a2cc9-cefa-4a99-a515-d7404e5662cd.json", "utf8"));
const source = report.dataSnapshot.submarketDetails.find((d: any) => d.displayName === "I-55 Corridor");
const keys: Record<string, string> = {
  "Inventory (SF)": "inventorySf", "Delivered (SF)": "deliveredSf", "Under Construction (SF)": "underConstructionSf", "Speculative Share": "speculativeShare",
  "Quarterly Net Absorption (SF)": "quarterlyNetAbsorptionSf", "Vacancy Rate": "vacancyRate", "Availability Rate": "availabilityRate", "Asking Net Rent (USD/SF)": "askingNetRentPsf", "Sales Volume (USD)": "salesVolume",
  "Trailing 12 Month Net Absorption (SF)": "trailing12MonthNetAbsorptionSf", "Median Sales Price (USD/SF)": "medianSalesPricePsf", "Leasing Activity (SF)": "leasingActivitySf",
};
const book = new ExcelJS.Workbook();
await book.xlsx.load(await readFile(path.join(root, "I-55 Corridor Market Statistics - Q3 2026.xlsx")) as any);
let checked = 0, blanks = 0, negatives = 0, zeros = 0;
function check(actual: ExcelJS.Cell, raw: unknown) {
  const expected = raw == null ? null : raw;
  if (typeof expected === "number") { assert.equal(typeof actual.value, "number"); assert.ok(Math.abs(Number(actual.value) - expected) < 1e-10); }
  else assert.equal(actual.value, expected);
  checked++; if (expected == null) blanks++; if (typeof expected === "number" && expected < 0) negatives++; if (expected === 0) zeros++;
}
const current = book.getWorksheet("Current Statistics")!;
current.eachRow((row, index) => { if (index < 6) return; const key = keys[String(row.getCell(1).value)]; assert.ok(key); check(row.getCell(2), source.metrics[key]); });
const history = book.getWorksheet("Historical Statistics")!;
history.eachRow((row, index) => {
  if (index < 6) return;
  const key = keys[String(row.getCell(1).value)]; assert.ok(key);
  for (let column = 2; column <= history.columnCount; column++) {
    const period = history.getRow(5).getCell(column).value;
    const raw = source.historicalPeriods.find((p: any) => p.period === period);
    assert.ok(raw); check(row.getCell(column), raw[key]);
  }
});
assert.ok(blanks > 0); assert.ok(negatives > 0); assert.ok(zeros > 0);
const result = { reportId: report.id, checkedCells: checked, preservedBlanks: blanks, preservedNegatives: negatives, preservedZeros: zeros, nativeNumericValues: true, savedSourceComparison: "passed" };
await writeFile(path.join(root, "workbook-source-values.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
