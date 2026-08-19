import { getReportDataProvider } from '../../data-providers/providerRegistry';
import type { ReportTemplate } from '../../types/report';
import { buildPresentationModel } from '../bindings/presentationModel';
import type { ReportGenerationRequest, ReportInstance } from '../schema/generation';
import { validateNormalizedReport } from '../validation/reportValidation';
import { expandTemplatePages } from './repeaters';

export interface GenerationProgress { stage: 'loading'|'normalizing'|'calculating'|'reconciling'|'validating'|'expanding'|'complete'; message: string; }

export async function generateReportInstance(template: ReportTemplate, request: ReportGenerationRequest, onProgress?: (progress: GenerationProgress)=>void): Promise<ReportInstance> {
  onProgress?.({stage:'loading',message:`Loading ${request.source.provider} data`});
  const normalized = await getReportDataProvider(request.source.provider).loadReportData(request);
  onProgress?.({stage:'normalizing',message:'Normalized source records'});
  onProgress?.({stage:'calculating',message:'Calculated market totals and weighted metrics'});
  onProgress?.({stage:'reconciling',message:'Resolved approved presentation overrides'});
  const issues = validateNormalizedReport(normalized);
  const errors = issues.filter(issue=>issue.level==='error');
  if (errors.length) throw new Error(`Report validation failed:\n${errors.map(issue=>`${issue.path}: ${issue.message}`).join('\n')}`);
  onProgress?.({stage:'validating',message:`Validated report data${issues.length?` with ${issues.length} warning(s)`:''}`});
  const presentationData = buildPresentationModel(normalized);
  const pages = expandTemplatePages(template,presentationData);
  onProgress?.({stage:'expanding',message:`Generated ${pages.length} editable page${pages.length===1?'':'s'}`});
  const instance: ReportInstance = {id:`report-${crypto.randomUUID()}`,templateId:template.id,templateVersion:template.version,generationRequest:structuredClone(request),generatedAt:new Date().toISOString(),dataSnapshot:structuredClone(normalized),pages,manualOverrides:[],status:'draft'};
  onProgress?.({stage:'complete',message:'Report ready to edit'});
  return instance;
}

