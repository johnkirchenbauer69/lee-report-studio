import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';
import { sampleTemplate } from '../../src/data/sampleTemplate';
import { generateReportInstance } from '../../src/report-engine/generation/generateReport';
import { revealInspectorControls } from '../support/editorDisclosures';

test('replaces a bound image in place and exports saved text edits through Chromium', async ({ page, request }) => {
  test.setTimeout(120000);
  const instance = await generateReportInstance(sampleTemplate, { templateId: sampleTemplate.id, templateVersion: sampleTemplate.version, market: 'Chicago', period: '2026 Q2', calculationScope: { type: 'all-submarkets' }, pageSelection: { submarketIds: [] }, source: { provider: 'sample' } });
  const sourceText = instance.pages.flatMap(p => p.elements).find(e => e.type === 'text')!;
  instance.pages = [{ ...instance.pages[0], elements: [
    { ...sourceText, id: 'editable-address', name: 'Property Address', type: 'text', x: 40, y: 250, width: 650, height: 80, text: 'Old address', binding: { path: 'overallMarket.narrative' }, style: { ...sourceText.style, fontSize: 16, color: '#003146' } },
    { id: 'editable-image', name: 'Property Image', type: 'image', x: 40, y: 40, width: 300, height: 180, src: '/brand/lee-icon.png', binding: { path: 'missingImage' }, fit: 'cover', style: {} }
  ] }];
  expect((await request.post('/api/report-instances', { data: instance })).ok()).toBeTruthy();
  await page.goto(`/?editor=1&report=${instance.id}`);
  await page.getByTestId('editable-image').click();
  await revealInspectorControls(page);
  await page.getByRole('button', { name: 'Upload replacement image', exact: true }).click();
  await page.locator('input[type=file]').last().setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvFkAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('.statusbar')).toContainText('Report saved');
  await expect(page.getByTestId('editable-image').locator('img')).toHaveAttribute('src', /\/api\/assets\//);
  await page.getByTestId('editable-address').click();
  await revealInspectorControls(page);
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('1500 Kautz Rd, Geneva, IL 60134');
  await expect(page.locator('.statusbar')).toContainText('1 manual override');
  await expect(page.locator('.statusbar')).toContainText('Report saved');
  const saved = await (await request.get(`/api/report-instances/${instance.id}`)).json();
  const image = saved.pages[0].elements.find((e: {id: string}) => e.id === 'editable-image');
  expect(image.binding).toBeUndefined();
  expect([image.x, image.y, image.width, image.height]).toEqual([40,40,300,180]);
  expect(saved.dataSnapshot).toEqual(instance.dataSnapshot);
  await page.reload();
  await expect(page.getByTestId('editable-address')).toContainText('1500 Kautz Rd, Geneva, IL 60134');
  const rendered = page.waitForResponse(r => r.url().endsWith('/api/render/pdf'), { timeout: 60000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  await page.getByRole('button', { name: /Export anyway/i }).click();
  expect((await rendered).ok()).toBeTruthy();
  const bytes = await readFile((await (await download).path())!);
  expect((await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text).toContain('1500 Kautz Rd, Geneva, IL 60134');
  await expect(page.getByTestId('editable-address')).toContainText('1500 Kautz Rd, Geneva, IL 60134');
});
