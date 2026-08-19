import type { ReportTemplate } from '../types/report';

export const sampleTemplate: ReportTemplate = {
  id: 'industrial-market-report',
  name: 'Industrial Market Report',
  version: '0.1.0',
  pages: [
    {
      id: 'cover',
      name: 'Cover',
      width: 816,
      height: 1056,
      background: '#f8fafc',
      elements: [
        { id: 'cover-band', type: 'shape', name: 'Cover Band', x: 0, y: 0, width: 816, height: 280, style: { background: '#111827' } },
        { id: 'cover-title', type: 'text', name: 'Report Title', x: 58, y: 88, width: 690, height: 92, text: '{{ report.title }}', binding: { path: 'report.title', label: 'Report Title' }, style: { fontFamily: 'Arial', fontSize: 38, fontWeight: 700, color: '#ffffff' } },
        { id: 'cover-period', type: 'text', name: 'Period', x: 60, y: 188, width: 300, height: 38, text: '{{ report.period }}', binding: { path: 'report.period', label: 'Report Period' }, style: { fontFamily: 'Arial', fontSize: 20, fontWeight: 600, color: '#ffffff' } },
        { id: 'cover-subtitle', type: 'text', name: 'Subtitle', x: 60, y: 360, width: 600, height: 110, text: 'Automated market intelligence, built from structured data.', style: { fontFamily: 'Arial', fontSize: 30, fontWeight: 700, color: '#101828' } },
        { id: 'cover-by', type: 'text', name: 'Prepared By', x: 60, y: 930, width: 400, height: 30, text: '{{ report.preparedBy }}', binding: { path: 'report.preparedBy', label: 'Prepared By' }, style: { fontFamily: 'Arial', fontSize: 15, fontWeight: 600, color: '#344054' } },
      ],
    },
    {
      id: 'overall',
      name: 'Overall Market',
      width: 816,
      height: 1056,
      background: '#ffffff',
      elements: [
        { id: 'overall-title', type: 'text', name: 'Page Title', x: 50, y: 42, width: 500, height: 48, text: 'Chicago Overall Market', style: { fontFamily: 'Arial', fontSize: 28, fontWeight: 700, color: '#101828' } },
        { id: 'metric-1-label', type: 'text', name: 'Vacancy Label', x: 50, y: 130, width: 150, height: 22, text: 'VACANCY', style: { fontFamily: 'Arial', fontSize: 11, fontWeight: 700, color: '#667085' } },
        { id: 'metric-1', type: 'text', name: 'Vacancy', x: 50, y: 152, width: 160, height: 52, text: '{{ overall_market.vacancy_rate }}', binding: { path: 'overall_market.vacancy_rate', label: 'Overall Vacancy', format: 'percentage', decimals: 1 }, style: { fontFamily: 'Arial', fontSize: 36, fontWeight: 700, color: '#101828' } },
        { id: 'metric-2-label', type: 'text', name: 'Availability Label', x: 250, y: 130, width: 150, height: 22, text: 'AVAILABILITY', style: { fontFamily: 'Arial', fontSize: 11, fontWeight: 700, color: '#667085' } },
        { id: 'metric-2', type: 'text', name: 'Availability', x: 250, y: 152, width: 160, height: 52, text: '{{ overall_market.availability_rate }}', binding: { path: 'overall_market.availability_rate', label: 'Overall Availability', format: 'percentage', decimals: 1 }, style: { fontFamily: 'Arial', fontSize: 36, fontWeight: 700, color: '#101828' } },
        { id: 'metric-3-label', type: 'text', name: 'Absorption Label', x: 450, y: 130, width: 180, height: 22, text: 'NET ABSORPTION', style: { fontFamily: 'Arial', fontSize: 11, fontWeight: 700, color: '#667085' } },
        { id: 'metric-3', type: 'text', name: 'Net Absorption', x: 450, y: 152, width: 250, height: 52, text: '{{ overall_market.net_absorption }}', binding: { path: 'overall_market.net_absorption', label: 'Net Absorption', format: 'sf', decimals: 1 }, style: { fontFamily: 'Arial', fontSize: 34, fontWeight: 700, color: '#101828' } },
        { id: 'market-table', type: 'table', name: 'Submarket Table', x: 50, y: 265, width: 716, height: 300, sourcePath: 'markets', maxRows: 8, columns: [
          { key: 'name', label: 'Submarket', path: 'name', format: 'text' },
          { key: 'inventory', label: 'Inventory', path: 'inventory_sf', format: 'sf' },
          { key: 'vacancy', label: 'Vacancy', path: 'vacancy_rate', format: 'percentage' },
          { key: 'availability', label: 'Availability', path: 'availability_rate', format: 'percentage' },
          { key: 'absorption', label: 'Net Absorption', path: 'net_absorption', format: 'integer' }
        ], style: { fontFamily: 'Arial', fontSize: 11, color: '#101828', borderColor: '#e4e7ec', borderWidth: 1 } },
        { id: 'market-chart', type: 'chart', name: 'Net Absorption Chart', x: 50, y: 620, width: 716, height: 320, sourcePath: 'markets', categoryPath: 'name', valuePath: 'net_absorption', chartType: 'bar', title: 'Net Absorption by Submarket', style: { background: '#ffffff', borderColor: '#e4e7ec', borderWidth: 1, borderRadius: 8 } }
      ],
    },
    {
      id: 'submarket',
      name: 'Submarket Template',
      width: 816,
      height: 1056,
      background: '#ffffff',
      elements: [
        { id: 'submarket-name', type: 'text', name: 'Market Name', x: 50, y: 50, width: 550, height: 54, text: '{{ market.name }} Industrial', binding: { path: 'market.name', label: 'Market Name' }, style: { fontFamily: 'Arial', fontSize: 30, fontWeight: 700, color: '#101828' } },
        { id: 'sub-vac-label', type: 'text', name: 'Vacancy Label', x: 50, y: 145, width: 120, height: 20, text: 'VACANCY', style: { fontFamily: 'Arial', fontSize: 10, fontWeight: 700, color: '#667085' } },
        { id: 'sub-vac', type: 'text', name: 'Vacancy', x: 50, y: 166, width: 160, height: 52, text: '{{ market.vacancy_rate }}', binding: { path: 'market.vacancy_rate', format: 'percentage', decimals: 1, label: 'Market Vacancy' }, style: { fontFamily: 'Arial', fontSize: 34, fontWeight: 700, color: '#101828' } },
        { id: 'top-leases', type: 'table', name: 'Top Leases', x: 50, y: 300, width: 716, height: 230, sourcePath: 'market.top_leases', maxRows: 3, columns: [
          { key: 'tenant', label: 'Tenant', path: 'tenant', format: 'text' },
          { key: 'address', label: 'Property', path: 'address', format: 'text' },
          { key: 'size', label: 'Size', path: 'size_sf', format: 'sf' }
        ], style: { fontFamily: 'Arial', fontSize: 12, color: '#101828', borderColor: '#e4e7ec', borderWidth: 1 } }
      ],
    }
  ],
};
