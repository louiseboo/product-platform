import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { startPreview } from './support/crowd-preview-server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { _private: api } = require('../cloudbase/functions/supplierFeedbackApi/index');
const options = ["Peet's档期测试", "Peet's新品提案", "Peet's老品维护", "Peet's特殊测试", 'Ora档期测试', 'Ora新品提案', 'Ora老品维护', 'Ora特殊测试'];
const base = { supplier_name: '示例供应商', product_name: '示例产品', status: '已确认', version_label: 'V1', product_type: '烘焙', campaign_year: '2027', campaign: '', created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
let server, browser, page, origin, rows, requests;
test.before(async () => {
  server = await startPreview();
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async () => {
  rows = options.map((category, i) => ({ ...base, id: `r${i}`, product_name: `示例产品${Math.floor(i / 4) ? i - 4 : i}`, test_category: category }));
  rows.push({ ...base, id: 'legacy', product_name: '历史产品', test_category: '档期测试', campaign: '02月｜优胜美地' });
  requests = [];
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => localStorage.setItem('burger-bom-tool-v1', '{"devRecords":[]}'));
  await page.route('**/api/supplier-feedback', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    let data;
    if (body.action === 'adminList') data = { records: rows };
    else if (body.action === 'adminUpdate') {
      const row = rows.find(item => item.id === body.id);
      Object.assign(row, api.normalizeAdminUpdatePayload(body.payload), { updated_at: new Date().toISOString() });
      data = { record: row };
    } else throw new Error(`Unexpected action ${body.action}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  await page.goto(`${origin}/decks/category-lab/supplier-submissions-admin.html?backend=cloudbase`);
  await page.locator('[data-status-filter="已确认"]').click();
});
test.afterEach(async () => { await page?.close(); });
async function openRow(id) {
  await page.locator('#sortSelect').selectOption('recent');
  await page.locator('#searchInput').fill(rows.find(row => row.id === id).product_name);
  const row = page.locator(`[data-record-id="${id}"]`);
  if (!(await row.isVisible())) {
    await page.locator('[data-product-group-key]').filter({ has: row }).locator('[data-product-group-toggle]').click();
  }
  await row.click();
}

test('eight branded workflow sections keep same-name products apart and preserve legacy records', async () => {
  assert.deepEqual(await page.locator('.test-category-title').allTextContents(), [...options, '档期测试（历史未标品牌）']);
  assert.equal(await page.locator('[data-product-group-key]').count(), 9);
  assert.equal(await page.locator('.test-category-bar').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), true);
  await page.locator('[data-test-category-toggle="ora-special"]').click();
  assert.equal(await page.locator('[data-test-category-body="ora-special"]').isVisible(), false);
  assert.equal(requests.filter(item => item.action !== 'adminList').length, 0);
});

test('PM purpose saves, survives reload, exports and imports; drafts trigger unsaved guard', async () => {
  await openRow('r2');
  assert.equal(await page.locator('[data-pm-maintenance]').isVisible(), true);
  assert.equal(await page.locator('[data-pm-campaign]').isVisible(), false);
  await page.locator('[data-field="maintenance_purpose"]').selectOption('产品复制');
  await page.locator('[data-status-filter="待处理"]').click();
  assert.equal(await page.locator('#unsavedChangesModal').isVisible(), true);
  await page.locator('[data-unsaved-cancel]').click();
  await page.locator('[data-save-active]').click();
  await page.getByText('已保存。', { exact: true }).waitFor();
  assert.equal(rows.find(row => row.id === 'r2').maintenance_purpose, '产品复制');
  await page.reload();
  await page.locator('[data-status-filter="已确认"]').click();
  await openRow('r2');
  assert.equal(await page.locator('[data-field="maintenance_purpose"]').inputValue(), '产品复制');
  const downloadWait = page.waitForEvent('download');
  await page.locator('#exportBtn').click();
  const download = await downloadWait;
  const csv = await readFile(await download.path(), 'utf8');
  assert.match(csv, /老品维护测试目的/);
  assert.match(csv, /产品复制/);
  await page.locator('[data-import-active]').click();
  await page.getByText(/已导入 Category Lab：/).waitFor();
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('burger-bom-tool-v1')).devRecords);
  assert.match(imported[0].supplierSubmissionSummary, /老品维护测试目的：产品复制/);
});

test('category correction immediately changes PM fields without losing other drafts', async () => {
  await openRow('r1');
  await page.locator('[data-field="tasting_feedback"]').fill('测试草稿');
  await page.locator('[data-toggle-supplier-edit]').click();
  const select = page.locator('[data-field="test_category"]');
  assert.deepEqual(await select.locator('option').allTextContents(), ['请选择', ...options]);
  await select.selectOption('Ora老品维护');
  assert.equal(await page.locator('[data-pm-maintenance]').isVisible(), true);
  await page.locator('[data-field="maintenance_purpose"]').selectOption('产品改进');
  await select.selectOption('Ora档期测试');
  assert.equal(await page.locator('[data-pm-campaign]').isVisible(), true);
  assert.equal(await page.locator('[data-field="tasting_feedback"]').inputValue(), '测试草稿');
  await select.selectOption('Ora老品维护');
  assert.equal(await page.locator('[data-field="maintenance_purpose"]').inputValue(), '产品改进');
});

test('PMO choices cover both years; historical campaign is preserved for review', async () => {
  await openRow('legacy');
  assert.equal(await page.locator('[data-field="campaign"]').inputValue(), '02月｜优胜美地');
  assert.equal(await page.locator('[data-campaign-legacy-note]').isVisible(), true);
  await page.locator('[data-toggle-campaign-options]').click();
  const names = await page.locator('[data-campaign-option]').allTextContents();
  assert.deepEqual(names.slice(0, 4).map(v => v.trim()), ['01月｜优胜美地', '02月｜CNY', '03月｜芝士分子周年庆', '04月｜创世巨星']);
  assert.equal(names.length, 12);
  await page.locator('[data-campaign-year]').selectOption('2026');
  assert.equal(await page.locator('[data-field="campaign"]').inputValue(), '02月｜优胜美地');
  assert.deepEqual((await page.locator('[data-campaign-option]').allTextContents()).slice(0, 2).map(v => v.trim()), ['01月｜CNY', '02月｜情人节']);
  assert.equal(requests.filter(item => item.action !== 'adminList').length, 0);
});

test('PM editor fits mobile and supplier form exposes only broad categories', async () => {
  await openRow('r2');
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  const html = await readFile(new URL('../decks/category-lab/supplier-submit.html', import.meta.url), 'utf8');
  await page.route('**/supplier-submit.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`${origin}/supplier-submit.html`);
  assert.deepEqual(await page.locator('#testCategory option').allTextContents(), ['请选择', ...options]);
  assert.equal(await page.locator('[name="maintenance_purpose"], [name="campaign"], [data-field="maintenance_purpose"]').count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /产品改进|产品复制|优胜美地/);
});


test('campaign collapse is independent between brands, including same stored manual group ID', async () => {
  for (const id of ['r0', 'r4']) Object.assign(rows.find(row => row.id === id), { campaign: '01月｜优胜美地', product_group_id: 'shared-historical-group' });
  await page.reload();
  await page.locator('[data-status-filter="已确认"]').click();
  assert.equal(await page.locator('[data-product-group-key]').count(), 9);
  const peets = page.locator('[data-test-category-body="peets-campaign"] [data-campaign-group-toggle]');
  const ora = page.locator('[data-test-category-body="ora-campaign"] [data-campaign-group-toggle]');
  const before = await ora.getAttribute('aria-expanded');
  await peets.click();
  assert.equal(await ora.getAttribute('aria-expanded'), before);
  assert.notEqual(await peets.getAttribute('data-campaign-group-toggle'), await ora.getAttribute('data-campaign-group-toggle'));
});
