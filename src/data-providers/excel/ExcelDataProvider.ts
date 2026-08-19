import * as XLSX from 'xlsx';
import { calculateMarketTotals } from '../../report-engine/calculations/marketCalculations';
import type { IndustrialMarketReport, MarketMetrics, ProvenanceRecord, SubmarketMetrics } from '../../report-engine/schema/industrialMarketReport';
import type { ReportGenerationRequest } from '../../report-engine/schema/generation';
import type { ReportDataProvider } from '../ReportDataProvider';
import { ReportImportError } from '../ReportDataProvider';
import { q2SampleReport } from '../sample/q2SampleReport';

type ExcelConfiguration = { data: ArrayBuffer | Uint8Array; fileName?: string };
type Row = (string | number | null)[];
const metricColumns: { key: keyof MarketMetrics; header: string }[] = [
  {key:'inventorySf',header:'inventory (sf)'},{key:'deliveredSf',header:'delivered (sf)'},{key:'underConstructionSf',header:'under construction (sf)'},
  {key:'speculativeShare',header:'construction speculative (%)'},{key:'netAbsorptionSf',header:'net absorption (sf)'},{key:'vacancyRate',header:'total vacant (%)'},
  {key:'availabilityRate',header:'total available (%)'},{key:'askingNetRentPsf',header:'asking net rent ($/sf)'},{key:'salesVolume',header:'sales volume ($)'},
];
const clean = (value: unknown) => String(value ?? '').replace(/\s+/g,' ').trim().toLowerCase();

export class ExcelDataProvider implements ReportDataProvider {
  readonly id = 'excel' as const;
  async loadReportData(request: ReportGenerationRequest): Promise<IndustrialMarketReport> {
    const config = request.source.configuration as Partial<ExcelConfiguration> | undefined;
    if (!config?.data) throw new ReportImportError('Import failed.', ['Choose the Submarket Stats workbook.']);
    const workbook = XLSX.read(config.data, { type:'array', cellDates:true });
    const sheetName = workbook.SheetNames.find(name => clean(name) === 'submarket table') ?? workbook.SheetNames[0];
    if (!sheetName) throw new ReportImportError('Import failed.', ['The workbook contains no worksheets.']);
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header:1, raw:true, defval:null });
    const headers = (rows[0] ?? []).map(clean);
    const nameColumn = headers.indexOf('submarket');
    const indexes = metricColumns.map(column => headers.indexOf(column.header));
    const missing = metricColumns.filter((_, index) => indexes[index] < 0).map(column => column.header);
    if (nameColumn < 0 || missing.length) throw new ReportImportError('Import failed.', [`Missing columns: ${['submarket',...missing].join(', ')}`]);
    const importedAt = new Date().toISOString();
    const provenance: ProvenanceRecord[] = [];
    const submarkets: SubmarketMetrics[] = [];
    rows.slice(1).forEach((row, rowOffset) => {
      const name = String(row[nameColumn] ?? '').trim();
      if (!name || name.toUpperCase().startsWith('MARKET ') || name.toUpperCase().startsWith('SUBMARKET ')) return;
      const values = indexes.map(index => Number(row[index]));
      if (values.some(value => !Number.isFinite(value))) throw new ReportImportError('Import failed.', [`${sheetName} row ${rowOffset + 2} contains a non-numeric metric.`]);
      const metric = Object.fromEntries(metricColumns.map((column,index)=>[column.key,values[index]])) as unknown as MarketMetrics;
      submarkets.push({name,...metric});
      metricColumns.forEach((column,index)=>provenance.push({fieldPath:`submarkets.${name}.${column.key}`,selectedValue:values[index],sources:[{sourceId:config.fileName??'excel-workbook',sourceType:'excel',value:values[index],reference:`${sheetName}!${XLSX.utils.encode_cell({r:rowOffset+1,c:indexes[index]})}`,importedAt}],authority:config.fileName??'Imported workbook',status:'matched'}));
    });
    if (!submarkets.length) throw new ReportImportError('Import failed.', ['No submarket rows were found.']);
    const allowed = new Set(request.selectedSubmarkets ?? []);
    const selected = allowed.size ? submarkets.filter(item=>allowed.has(item.name)) : submarkets;
    const base = structuredClone(q2SampleReport);
    return {...base,report:{...base.report,market:request.market,period:request.period,templateId:request.templateId},submarkets:selected,overallMarket:{...base.overallMarket,...calculateMarketTotals(selected)},provenance:[...provenance,...base.provenance.filter(record=>!record.fieldPath.startsWith('submarkets.'))]};
  }
}

