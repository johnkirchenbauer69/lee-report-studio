import type { IndustrialMarketReport } from '../schema/industrialMarketReport';

export interface ReportValidationIssue { path: string; message: string; level: 'error' | 'warning'; }

export function validateNormalizedReport(report: IndustrialMarketReport): ReportValidationIssue[] {
  const issues: ReportValidationIssue[] = [];
  if (!report.submarkets.length) issues.push({path:'submarkets',message:'At least one submarket is required.',level:'error'});
  report.submarkets.forEach((market,index)=>{
    if (market.inventorySf < 0) issues.push({path:`submarkets[${index}].inventorySf`,message:'Inventory cannot be negative.',level:'error'});
    if (market.inventorySf === 0) issues.push({path:`submarkets[${index}].inventorySf`,message:'Weighted market rates exclude zero-inventory submarkets.',level:'warning'});
    if (market.vacancyRate < 0 || market.vacancyRate > 1) issues.push({path:`submarkets[${index}].vacancyRate`,message:'Vacancy must be stored as a decimal between 0 and 1.',level:'error'});
    if (market.availabilityRate < 0 || market.availabilityRate > 1) issues.push({path:`submarkets[${index}].availabilityRate`,message:'Availability must be stored as a decimal between 0 and 1.',level:'error'});
  });
  report.provenance.filter(record=>record.status==='conflict').forEach(record=>issues.push({path:record.fieldPath,message:record.note??'This field has an unresolved source conflict.',level:'warning'}));
  return issues;
}

