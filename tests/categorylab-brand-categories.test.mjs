import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { startPreview } from './support/crowd-preview-server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { _private: api } = require('../cloudbase/functions/supplierFeedbackApi/index');
const options = ["Peet's档期测试", "Peet's新品提案", "Peet's老品维护", "Peet's特殊测试", 'Ora档期测试', 'Ora新品提案', 'Ora老品维护', 'Ora特殊测试'];
const labels = options.map(value => value === 'Ora档期测试' ? 'Ora月度测试' : value);
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
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => { localStorage.setItem('burger-bom-tool-v1', '{"devRecords":[]}'); sessionStorage.setItem('categorylabCloudbaseAdminCode', 'test-only'); });
  await page.route('**/api/supplier-feedback', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    let data;
    if (body.action === 'adminLogin') data = { profile: { role: 'owner' } };
    else if (body.action === 'adminList') data = { records: rows };
    else if (body.action === 'adminUpdate') {
      const row = rows.find(item => item.id === body.id);
      Object.assign(row, api.normalizeAdminUpdatePayload(body.payload), { updated_at: new Date().toISOString() });
      data = { record: row };
    } else throw new Error(`Unexpected action ${body.action}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  await page.goto(`${origin}/decks/category-lab/supplier-submissions-admin.html?backend=cloudbase`);
  await page.locator('[data-status-filter="已确认"]').click();
  await page.locator('#sortSelect').selectOption('workflow');
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
  assert.deepEqual(await page.locator('.test-category-title').allTextContents(), [...labels, '档期测试（历史未标品牌）']);
  assert.equal(await page.locator('[data-product-group-key]').count(), 9);
  assert.equal(await page.locator('.test-category-bar').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), true);
  await page.locator('[data-test-category-toggle="ora-special"]').click();
  assert.equal(await page.locator('[data-test-category-body="ora-special"]').isVisible(), false);
  assert.equal(requests.filter(item => !['adminList', 'adminLogin'].includes(item.action)).length, 0);
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
  assert.deepEqual(await select.locator('option').allTextContents(), ['请选择', ...labels]);
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
  assert.equal(requests.filter(item => !['adminList', 'adminLogin'].includes(item.action)).length, 0);
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
  assert.deepEqual(await page.locator('#testCategory option').allTextContents(), ['请选择', ...labels]);
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


test('Ora groups historical names by year and month while Peets retains its campaign', async () => {
  Object.assign(rows.find(row => row.id === 'r0'), { campaign: '01月｜优胜美地' });
  Object.assign(rows.find(row => row.id === 'r4'), { campaign: '01月｜优胜美地' });
  rows.push({ ...base, id: 'ora-cny', product_name: '另一款月度产品', test_category: 'Ora档期测试', campaign: '01月｜CNY（含烘焙 / 三明治换新）' });
  await page.reload();
  await page.locator('[data-status-filter="已确认"]').click();
  await page.locator('#sortSelect').selectOption('workflow');
  const ora = page.locator('[data-test-category-body="ora-campaign"]');
  assert.equal(await ora.locator('[data-campaign-group]').count(), 1);
  assert.match(await ora.locator('[data-campaign-group]').innerText(), /2027 年 01月/);
  assert.doesNotMatch(await ora.innerText(), /优胜美地|CNY|档期/);
  assert.match(await page.locator('[data-test-category-body="peets-campaign"]').innerText(), /优胜美地/);
  assert.equal(requests.filter(item => !['adminList', 'adminLogin'].includes(item.action)).length, 0);
});

test('Ora month editor normalizes legacy names without dirtying the record and saves only month', async () => {
  Object.assign(rows.find(row => row.id === 'r4'), { campaign: '01月｜CNY', round_conclusion: '通过且进入众测' });
  await page.reload();
  await page.locator('[data-status-filter="已确认"]').click();
  await openRow('r4');
  const month = page.locator('select[data-field="campaign"]');
  assert.equal(await month.inputValue(), '01月');
  assert.equal(await month.locator('option').count(), 13);
  assert.match(await page.locator('[data-pm-campaign]').innerText(), /年份 \/ 月份/);
  assert.equal(await page.locator('[data-toggle-campaign-options]').count(), 0);
  await page.locator('[data-status-filter="待处理"]').click();
  assert.equal(await page.locator('#unsavedChangesModal').isVisible(), false);
  await page.locator('[data-status-filter="已确认"]').click();
  await openRow('r4');
  await month.selectOption('02月');
  await page.locator('[data-save-active]').click();
  await page.getByText('已保存。', { exact: true }).waitFor();
  assert.equal(rows.find(row => row.id === 'r4').campaign, '02月');
  await page.reload();
  await page.locator('[data-status-filter="已确认"]').click();
  await openRow('r4');
  assert.equal(await month.inputValue(), '02月');
  await page.locator('#crowdProductsTab').click();
  assert.match(await page.locator('#crowdProductsPane').innerText(), /02月/);
  assert.doesNotMatch(await page.locator('#crowdProductsPane').innerText(), /CNY/);
});

test('switching brands updates month controls and preserves year and other unsaved fields', async () => {
  await openRow('r0');
  await page.locator('[data-field="tasting_feedback"]').fill('保留测试反馈');
  await page.locator('[data-field="campaign"]').fill('03月｜芝士分子周年庆');
  await page.locator('[data-toggle-supplier-edit]').click();
  await page.locator('[data-field="test_category"]').selectOption('Ora档期测试');
  assert.equal(await page.locator('select[data-field="campaign"]').inputValue(), '03月');
  assert.equal(await page.locator('[data-field="campaign_year"]').inputValue(), '2027');
  assert.equal(await page.locator('[data-field="tasting_feedback"]').inputValue(), '保留测试反馈');
  await page.locator('[data-field="test_category"]').selectOption("Peet's档期测试");
  assert.equal(await page.locator('input[data-field="campaign"]').count(), 1);
  assert.equal(await page.locator('[data-toggle-campaign-options]').count(), 1);
});


test('crowd overview separates brands, periods and product types without mixing versions', async () => {
  Object.assign(rows.find(row => row.id === 'r0'), { campaign: '01月｜优胜美地', round_conclusion: '通过且进入众测', product_type: '蛋糕' });
  Object.assign(rows.find(row => row.id === 'r4'), { campaign: '01月｜CNY', round_conclusion: '通过且进入众测', product_type: '烘焙' });
  rows.push({ ...base, id: 'ora-sandwich', product_name: '月度三明治', test_category: 'Ora档期测试', campaign: '01月｜优胜美地', round_conclusion: '通过且进入众测', product_type: '三明治' });
  rows.push({ ...base, id: 'unclassified', product_name: '待分类新品', test_category: '', campaign: '', round_conclusion: '通过且进入众测', product_type: '' });
  await page.reload();
  await page.locator('#crowdProductsTab').click();
  assert.deepEqual(await page.locator('.crowd-brand-title').allTextContents(), ["Peet's", 'Ora', '历史未标品牌']);
  const ora = page.locator('[data-crowd-brand="ora"]');
  assert.equal(await ora.locator('[data-crowd-year="2027"] .crowd-campaign').count(), 1);
  assert.deepEqual(await ora.locator('.crowd-type-title').allTextContents(), ['烘焙', '三明治']);
  assert.doesNotMatch(await ora.innerText(), /CNY|优胜美地|档期/);
  assert.equal(await ora.locator('[data-crowd-latest="r4"]').count(), 1);
  assert.equal(await ora.locator('[data-crowd-latest="r0"]').count(), 0);
  assert.match(await page.locator('[data-crowd-brand="peets"]').innerText(), /优胜美地/);
  assert.match(await page.locator('[data-crowd-brand="legacy"]').innerText(), /品类待补充/);
  assert.equal(await page.locator('[data-crowd-latest]').count(), 4);
  const oraBakery = ora.locator('[data-crowd-type="烘焙"]');
  const toggle = oraBakery.locator('[data-crowd-type-toggle]');
  assert.equal(await toggle.locator('.product-type-caret').innerText(), '▼');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await oraBakery.locator('table').isVisible(), false);
  assert.equal(await ora.locator('[data-crowd-type="三明治"] table').isVisible(), true);
  await page.locator('#searchInput').fill('示例产品');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await page.locator('#searchInput').fill('');
  await toggle.press('Enter');
  assert.equal(await oraBakery.locator('table').isVisible(), true);

  await page.locator('#searchInput').fill('月度三明治');
  assert.deepEqual(await page.locator('.crowd-brand-title').allTextContents(), ['Ora']);
  assert.equal(await page.locator('[data-crowd-latest]').count(), 1);
});


test('brand sections are distinct and category triangles collapse only their own branch', async () => {
  assert.deepEqual(await page.locator('.inbox-brand-title').allTextContents(), ["Peet's", 'Ora', '历史未标品牌']);
  const peets = page.locator('[data-inbox-brand="peets"]');
  const ora = page.locator('[data-inbox-brand="ora"]');
  assert.equal(await peets.locator('[data-test-category-section^="ora-"]').count(), 0);
  assert.notEqual(await peets.locator('.inbox-brand-bar').evaluate(el => getComputedStyle(el).backgroundColor), await ora.locator('.inbox-brand-bar').evaluate(el => getComputedStyle(el).backgroundColor));
  for (const brand of ['peets', 'ora']) {
    const campaign = page.locator(`[data-test-category-body="${brand}-campaign"] [data-campaign-group-toggle]`);
    if (await campaign.getAttribute('aria-expanded') === 'false') await campaign.click();
  }
  const button = peets.locator('[data-test-category-body="peets-campaign"] [data-product-type-toggle]');
  const other = ora.locator('[data-test-category-body="ora-campaign"] [data-product-type-toggle]');
  assert.equal(await button.locator('.product-type-caret').innerText(), '▼');
  assert.equal(await button.getAttribute('aria-expanded'), 'true');
  await button.click();
  assert.equal(await button.getAttribute('aria-expanded'), 'false');
  assert.equal(await peets.locator('[data-test-category-body="peets-campaign"] [data-product-type-body]').isVisible(), false);
  assert.equal(await other.getAttribute('aria-expanded'), 'true');
  await button.press('Enter');
  assert.equal(await button.getAttribute('aria-expanded'), 'true');
  assert.equal(requests.filter(item => !['adminList', 'adminLogin'].includes(item.action)).length, 0);
});


test('narrow sidebar keeps brand labels and category triangles within its width', async () => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(() => document.documentElement.style.setProperty('--inbox-left-width', '260px'));
  assert.equal(await page.locator('.list-pane').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  assert.equal(await page.locator('.product-type-caret').evaluateAll(nodes => {
    const pane = document.querySelector('.list-pane').getBoundingClientRect();
    return nodes.filter(node => node.getClientRects().length).every(node => node.getBoundingClientRect().right <= pane.right);
  }), true);
});
