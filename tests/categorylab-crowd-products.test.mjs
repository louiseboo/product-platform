import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { startPreview } from './support/crowd-preview-server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
let server, browser, page, url;
test.before(async () => {
  server = await startPreview();
  url = `http://127.0.0.1:${server.address().port}/decks/category-lab/supplier-submissions-admin.html?backend=cloudbase`;
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
});
test.after(async () => { await browser?.close(); await new Promise(r => server.close(r)); });
test.beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => sessionStorage.setItem('categorylabCloudbaseAdminCode', 'test-only'));
  await page.route('**/api/supplier-feedback', async route => {
    if (route.request().postDataJSON().action === 'adminLogin') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { profile: { role: 'owner' } } }) });
    } else await route.continue();
  });
  await page.goto(url);
  await page.locator('#pendingCount').getByText('1', { exact: true }).waitFor();
});
test.afterEach(async () => { await page.close(); });

test('adds independent overview without altering original status tabs', async () => {
  assert.equal(await page.locator('#crowdProductsTab').count(), 1);
  await page.locator('#crowdProductsTab').click();
  assert.equal(await page.locator('[data-status-filter]').count(), 3);
  assert.equal(await page.locator('.workspace').isVisible(), false);
  assert.equal(await page.locator('#crowdProductsPane').isVisible(), true);
});

test('groups actual years and canonical campaigns; quotes belong to eligible versions', async () => {
  await page.locator('#crowdProductsTab').click({ timeout: 1000 });
  assert.deepEqual(await page.locator('.crowd-year-title').allTextContents(), ['2027 年', '2026 年', '年份待补充']);
  assert.equal(await page.locator('[data-crowd-year="2027"] .crowd-campaign').count(), 2);
  const latest = page.locator('[data-crowd-latest="beef-v2"]');
  assert.match(await latest.innerText(), /待报价/);
  assert.doesNotMatch(await latest.innerText(), /9\.20/);
  assert.equal(await page.locator('[data-crowd-latest="cake-trial"]').count(), 0);
  assert.equal(await page.locator('[data-crowd-latest="cake"]').count(), 1);
  assert.equal(await page.locator('[data-crowd-latest="same-name"]').count(), 1);
  await page.locator('[data-crowd-latest="sandwich-v2"] [data-crowd-toggle]').click();
  assert.match(await page.locator('[data-crowd-history="sandwich-v1"]').innerText(), /8\.60/);
});

test('search, record detail and return keep overview context', async () => {
  await page.locator('#crowdProductsTab').click({ timeout: 1000 });
  await page.locator('#searchInput').fill('香辣牛肉');
  assert.equal(await page.locator('[data-crowd-latest]').count(), 1);
  await page.locator('[data-crowd-open="beef-v2"]').click();
  assert.equal(await page.locator('.workspace').isVisible(), true);
  assert.match(await page.locator('#detailPane').innerText(), /香辣牛肉/);
  await page.locator('#crowdProductsTab').click();
  assert.equal(await page.locator('#searchInput').inputValue(), '香辣牛肉');
  await page.locator('#searchInput').fill('没有这个产品');
  assert.match(await page.locator('#crowdProductsPane').innerText(), /没有匹配/);
});

test('overview switch respects unsaved changes', async () => {
  await page.locator('[data-field="quote_rmb"]').fill('5.8');
  await page.locator('#crowdProductsTab').click({ timeout: 1000 });
  assert.equal(await page.locator('#unsavedChangesModal').isVisible(), true);
  await page.locator('[data-unsaved-cancel]').click();
  assert.equal(await page.locator('.workspace').isVisible(), true);
  assert.equal(await page.locator('[data-field="quote_rmb"]').inputValue(), '5.8');
});

test('mobile view has no horizontal overflow; preview writes forbidden', async () => {
  await page.locator('#crowdProductsTab').click({ timeout: 1000 });
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await page.evaluate(() => ['.topbar', '.filterbar', '#crowdProductsPane'].map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }));
    assert.ok(bounds[0].bottom <= bounds[1].top + 1, 'topbar must not overlap tabs');
    assert.ok(bounds[1].bottom <= bounds[2].top + 1, 'tabs must not overlap content');
    const tabBox = await page.locator('#crowdProductsTab').boundingBox();
    assert.ok(tabBox.y + tabBox.height <= bounds[1].bottom + 1, 'new tab stays inside filterbar');
    assert.equal(await page.locator('[data-crowd-latest="beef-v2"]').isVisible(), true);
  }
  const result = await page.request.post(new URL('/api/supplier-feedback', url).href, { data: { action: 'adminUpdate' } });
  assert.equal(result.status(), 403);
});
