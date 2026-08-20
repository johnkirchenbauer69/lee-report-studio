import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { sampleData } from '../data/sampleData';
import { sampleTemplate } from '../data/sampleTemplate';
import { createReportPdfBytes } from './pdfExport';
import type { ReportTemplate, TableElement } from '../types/report';

describe('deterministic PDF export', () => {
  it('renders every visible page in template order', async () => {
    const bytes = await createReportPdfBytes(sampleTemplate, sampleData);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(sampleTemplate.pages.filter(page => !page.hidden).length);
    expect(document.getPages()[0].getSize()).toEqual({ width: 612, height: 792 });
  });

  it('produces identical bytes for identical input (successful export path)', async () => {
    const first = await createReportPdfBytes(sampleTemplate, sampleData);
    const second = await createReportPdfBytes(sampleTemplate, sampleData);
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('rejects a rotated table with a specific, actionable message (failed export path)', async () => {
    const rotatedTable: TableElement = {
      id: 'rotated-table',
      type: 'table',
      name: 'Rotated table',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 30,
      style: {},
      sourcePath: 'sample',
      columns: [{ key: 'a', label: 'A', path: 'a' }],
    };
    const template: ReportTemplate = {
      ...sampleTemplate,
      pages: [
        {
          ...sampleTemplate.pages[0],
          elements: [rotatedTable],
        },
      ],
    };
    await expect(createReportPdfBytes(template, sampleData)).rejects.toThrow(
      /Rotated table elements require the Chromium PDF renderer\./,
    );
  });
});
