import type { IndustrialMarketReport } from './industrialMarketReport';
import type { ReportPage } from '../../types/report';

export type ReportProviderId = 'sample' | 'json' | 'excel' | 'ascendix';

export interface ReportGenerationRequest {
  templateId: string;
  market: string;
  period: string;
  selectedSubmarkets?: string[];
  source: { provider: ReportProviderId; configuration?: unknown };
}

export interface ManualOverride {
  elementId: string;
  bindingPath?: string;
  generatedValue: unknown;
  overrideValue: unknown;
  createdAt: string;
}

export interface ReportInstance {
  id: string;
  templateId: string;
  templateVersion: string;
  generationRequest: ReportGenerationRequest;
  generatedAt: string;
  dataSnapshot: IndustrialMarketReport;
  pages: ReportPage[];
  manualOverrides: ManualOverride[];
  status: 'draft' | 'approved' | 'published';
}

