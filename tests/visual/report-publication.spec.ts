import { test, expect } from '@playwright/test';
import { sampleTemplate } from '../../src/data/sampleTemplate';
import { generateReportInstance } from '../../src/report-engine/generation/generateReport';

test('publishes the saved report, reopens its finalized edition and preserves overrides', async ({ page, request }) => {
  const instance = await generateReportInstance(sampleTemplate, { templateId: sampleTemplate.id, templateVersion: sampleTemplate.version, market: 'Chicago', period: '2026 Q2', calculationScope: { type: 'all-submarkets' }, pageSelection: { submarketIds: [] }, source: { provider: 'sample' } });
  instance.manualOverrides = [{ elementId: 'indicator-table', cellKey: '["metricKey:trailing12MonthNetAbsorptionSf","period:2025 Q3"]', bindingPath: 'indicatorRows.prior', generatedValue: '—', overrideValue: '12,657,528', createdAt: new Date().toISOString() }];
  const created = await request.post('/api/report-instances', { data: instance });
  expect(created.ok()).toBeTruthy();
  const saved = await created.json();
  await page.goto(`/?editor=1&report=${saved.id}`);
  const publish = page.getByRole('button', { name: 'Publish Report', exact: true });
  await expect(publish).toBeEnabled({ timeout: 30000 });
  await publish.click();
  await page.getByRole('button', { name: 'Confirm Publish Report', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Published report', exact: true })).toBeDisabled();
  const reopened = await (await request.get(`/api/report-instances/${saved.id}`)).json();
  expect(reopened.status).toBe('published');
  expect(reopened.pages).toEqual(saved.pages);
  expect(reopened.manualOverrides).toEqual(saved.manualOverrides);
  expect(reopened.dataSnapshot).toEqual(saved.dataSnapshot);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Published report', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '← Reports', exact: true }).click();
  await page.getByRole('button', { name: 'Published reports', exact: true }).click();
  await expect(page.locator('.library-card').filter({ hasText: saved.id })).toBeVisible();
});

