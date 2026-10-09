import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { marketAssetFixture } from '../support/marketAssetFixture';

// Task simulations in guarded, disposable storage; never real-user research.
test('audit every editor panel, creation steps and desktop sizes', async ({ page }, info) => {
  test.setTimeout(120_000);
  const evidence = path.resolve('docs/evidence/ux-ui', process.env.UX_AUDIT_PHASE ?? 'current');
  await mkdir(evidence, { recursive: true });
  const capture = async (name: string) => page.screenshot({ path: path.join(evidence, `${name}.png`) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?editor=1', { waitUntil: 'networkidle' });
  await capture('editor');
  for (const title of ['Templates', 'Pages', 'Elements', 'Text', 'Images', 'Uploads', 'Fonts', 'Data', 'QA']) {
    await page.locator('.rail').getByTitle(title, { exact: true }).click();
    await expect(page.locator('.left-panel')).toBeVisible();
    await capture(`panel-${title.toLowerCase()}`);
  }
  const sizes = [];
  for (const [width, height] of [[1366,768], [1440,900], [1920,1080], [2560,1440]]) {
    await page.setViewportSize({ width, height });
    sizes.push(await page.locator('.document-header').evaluate(bar => ({
      width: innerWidth, height: innerHeight, toolbarWidth: bar.scrollWidth,
      toolbarClient: bar.clientWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      exportRight: bar.querySelector('.primary-button')!.getBoundingClientRect().right,
    })));
    await capture(`desktop-${width}`);
  }
  await writeFile(path.join(evidence, 'desktop-measurements.json'), JSON.stringify(sizes, null, 2));
  await page.setViewportSize({ width:1440, height:900 });
  await page.getByRole('button', { name: /Create report$/, exact: false }).first().click();
  const wizard = page.getByRole('dialog', { name:'Create report', exact:true });
  await expect(wizard).toBeVisible();
  for (let step=0; step<5; step++) {
    await capture(`create-step-${step+1}`);
    if (step<4) await wizard.getByRole('button', {name:'Continue', exact:true}).click();
  }
  await wizard.getByRole('button', {name:'Load & Validate Data'}).click();
  await expect(wizard.getByRole('button', {name:'Review Report', exact:true})).toBeVisible();
  await capture('create-narratives');
  await wizard.getByRole('button', {name:'Review Report', exact:true}).click();
  await capture('create-review');
  await wizard.getByRole('button', {name:'Open Report Editor', exact:true}).click();
  await expect(wizard).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('Report');
  await capture('generated-report');
  await info.attach('desktop measurements', {body:JSON.stringify(sizes),contentType:'application/json'});
});

test('audit saved 44-page report navigation and I-55 export inventory', async ({ page, request }) => {
  test.setTimeout(120_000);
  const evidence=path.resolve('docs/evidence/ux-ui', process.env.UX_AUDIT_PHASE ?? 'current');
  await mkdir(evidence,{recursive:true});
  const instance=await marketAssetFixture();
  // The export fixture restates its data to Q3; keep audit document captions
  // consistent with that explicitly synthetic period.
  instance.generationRequest.period=instance.dataSnapshot.report.period;
  instance.id=`report-ux-audit-${crypto.randomUUID()}`;
  const saved=await request.post('/api/report-instances',{data:instance});
  expect(saved.ok()).toBeTruthy();
  await page.addInitScript(id => localStorage.setItem('lee-report-studio.report-instance.v1',id),instance.id);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/?editor=1',{waitUntil:'networkidle'});
  await page.locator('.rail').getByTitle('Pages',{exact:true}).click();
  await expect(page.locator('.page-list > button')).toHaveCount(44);
  const target=page.locator('.page-list > button').filter({hasText:'I-55'}).first();
  await target.click();
  await expect(target).toHaveClass(/active/);
  await page.screenshot({path:path.join(evidence,'report-44-pages-i55.png')});
  await page.getByRole('link',{name:'Market Assets',exact:true}).click();
  await page.getByLabel('Saved report',{exact:true}).selectOption(instance.id);
  await page.getByRole('button',{name:'Clear markets',exact:true}).click();
  await page.getByRole('checkbox',{name:/I-55/}).check();
  await page.getByRole('button',{name:'Clear categories',exact:true}).click();
  await page.getByRole('checkbox',{name:/Charts/}).check();
  await page.getByRole('button',{name:'Preview export',exact:true}).click();
  await expect(page.locator('.asset-preview')).toBeVisible();
  await page.screenshot({path:path.join(evidence,'market-assets-i55.png'),fullPage:true});
});

test('inspect contextual controls and constrained desktop layouts', async ({page, request}) => {
  test.setTimeout(120_000);
  const evidence=path.resolve('docs/evidence/ux-ui/implemented');
  await mkdir(evidence,{recursive:true});
  // Use an explicitly saved generated report for contextual control evidence.
  const instance=await marketAssetFixture();instance.id=`report-ux-narrative-${crypto.randomUUID()}`;
  instance.generationRequest.period=instance.dataSnapshot.report.period;
  expect((await request.post('/api/report-instances',{data:instance})).ok()).toBeTruthy();
  await page.addInitScript(id=>localStorage.setItem('lee-report-studio.report-instance.v1',id),instance.id);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/?editor=1',{waitUntil:'networkidle'});
  await page.locator('.rail').getByTitle('Elements',{exact:true}).click();
  const layer=(type:string)=>page.locator('.layer-list > button').filter({has:page.locator('small').filter({hasText:new RegExp(`^${type}$`)})}).first();
  await layer('text').click();
  await expect(page.locator('.inspector textarea').first()).toBeVisible();
  await page.screenshot({path:path.join(evidence,'inspector-text.png')});
  await layer('image').click();
  await expect(page.getByRole('button',{name:'Replace Image',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(evidence,'inspector-image.png')});
  await page.locator('.rail').getByTitle('Pages',{exact:true}).click();
  await page.locator('.page-list > button').filter({hasText:'Market Overview'}).first().click();
  await page.locator('.rail').getByTitle('Elements',{exact:true}).click();
  await layer('chart').click();
  await page.screenshot({path:path.join(evidence,'inspector-chart.png')});
  await layer('table').click();
  await page.screenshot({path:path.join(evidence,'inspector-table.png')});
  // CSS zoom approximation; this does not claim browser zoom or Windows DPI testing.
  await page.evaluate(()=>{document.body.style.zoom='1.25';});
  await page.screenshot({path:path.join(evidence,'css-zoom-125.png')});
  await page.evaluate(()=>{document.body.style.zoom='';});
  await page.setViewportSize({width:1093,height:614});
  const bounds=await page.getByRole('button',{name:'Export PDF',exact:true}).boundingBox();
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(1093);
  await page.screenshot({path:path.join(evidence,'narrow-desktop.png')});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`/?narrativeReview=${instance.id}`,{waitUntil:'networkidle'});
  await expect(page.getByTestId('narrative-workspace')).toBeVisible();
  await page.screenshot({path:path.join(evidence,'narrative-review.png')});
});
