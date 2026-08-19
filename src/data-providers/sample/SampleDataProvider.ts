import type { ReportDataProvider } from '../ReportDataProvider';
import type { ReportGenerationRequest } from '../../report-engine/schema/generation';
import { calculateMarketTotals } from '../../report-engine/calculations/marketCalculations';
import { q2SampleReport } from './q2SampleReport';

export class SampleDataProvider implements ReportDataProvider {
  readonly id = 'sample' as const;
  async loadReportData(request: ReportGenerationRequest) {
    const report = structuredClone(q2SampleReport);
    const allowed = new Set(request.selectedSubmarkets ?? []);
    if (allowed.size) report.submarkets = report.submarkets.filter(item => allowed.has(item.name));
    report.report = { ...report.report, market:request.market, period:request.period, templateId:request.templateId };
    report.overallMarket = { ...report.overallMarket, ...calculateMarketTotals(report.submarkets) };
    return report;
  }
}

