import { ZodError } from 'zod';
import { industrialMarketReportSchema } from '../../report-engine/schema/industrialMarketReport';
import type { ReportGenerationRequest } from '../../report-engine/schema/generation';
import type { ReportDataProvider } from '../ReportDataProvider';
import { ReportImportError } from '../ReportDataProvider';

type JsonConfiguration = { payload: string | unknown };

function describeZodError(error: ZodError): string[] {
  return error.issues.map(issue => `${issue.path.join('.') || 'report'}: ${issue.message}`);
}

export class JsonDataProvider implements ReportDataProvider {
  readonly id = 'json' as const;
  async loadReportData(request: ReportGenerationRequest) {
    const config = request.source.configuration as Partial<JsonConfiguration> | undefined;
    if (config?.payload == null) throw new ReportImportError('Import failed.', ['Choose a JSON report file or provide a normalized payload.']);
    let payload: unknown = config.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); }
      catch { throw new ReportImportError('Import failed.', ['The selected file is not valid JSON.']); }
    }
    const result = industrialMarketReportSchema.safeParse(payload);
    if (!result.success) throw new ReportImportError('Import failed.', describeZodError(result.error));
    return structuredClone(result.data);
  }
}

