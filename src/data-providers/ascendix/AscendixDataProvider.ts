import { industrialMarketReportSchema } from '../../report-engine/schema/industrialMarketReport';
import type { ReportGenerationRequest } from '../../report-engine/schema/generation';
import type { ReportDataProvider } from '../ReportDataProvider';
import { ReportImportError } from '../ReportDataProvider';

export class AscendixDataProvider implements ReportDataProvider {
  readonly id = 'ascendix' as const;
  constructor(private readonly endpoint = '/api/report-data/ascendix') {}
  async loadReportData(request: ReportGenerationRequest) {
    const response = await fetch(this.endpoint, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
    if (!response.ok) throw new ReportImportError('Ascendix import is unavailable.', ['Configure the authenticated server-side Ascendix/Salesforce adapter. No credentials are accepted in the browser.']);
    const parsed = industrialMarketReportSchema.safeParse(await response.json());
    if (!parsed.success) throw new ReportImportError('Ascendix returned an invalid report payload.', parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`));
    return parsed.data;
  }
}

