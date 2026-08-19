import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { sampleData } from '../data/sampleData';
import { sampleTemplate } from '../data/sampleTemplate';
import { createReportPdfBytes } from './pdfExport';

describe('deterministic PDF export', () => {
  it('renders every visible page in template order', async () => {
    const bytes = await createReportPdfBytes(sampleTemplate, sampleData);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(sampleTemplate.pages.filter(page => !page.hidden).length);
    expect(document.getPages()[0].getSize()).toEqual({ width: 612, height: 792 });
  });

  it('produces identical bytes for identical input', async () => {
    const first = await createReportPdfBytes(sampleTemplate, sampleData);
    const second = await createReportPdfBytes(sampleTemplate, sampleData);
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});
