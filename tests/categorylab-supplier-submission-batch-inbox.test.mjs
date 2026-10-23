import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inboxPath = "/decks/category-lab/supplier-submissions-admin.html";
const seedRecords = [
  { id: "a-0", submission_batch_id: "batch-a", batch_item_index: 0, supplier_name: "佰翔空厨食品有限公司", product_name: "牛肝菌黑松露恰巴塔", version_label: "V1", sample_date: "2026-08-22", product_type: "烘焙", test_category: "新品提案", version_change: "第一项", status: "待处理", created_at: "2026-08-28T02:00:00.000Z", updated_at: "2026-08-28T02:00:00.000Z" },
  { id: "a-1", submission_batch_id: "batch-a", batch_item_index: 1, supplier_name: "佰翔空厨食品有限公司", product_name: "黑豆松子恰巴塔", version_label: "V1", sample_date: "2026-08-22", product_type: "烘焙", test_category: "新品提案", version_change: "第二项", status: "待处理", created_at: "2026-08-28T02:00:02.000Z", updated_at: "2026-08-28T02:00:02.000Z" },
  { id: "a-2", submission_batch_id: "batch-a", batch_item_index: 2, supplier_name: "佰翔空厨食品有限公司", product_name: "云朵吐司", version_label: "V1", sample_date: "2026-08-22", product_type: "烘焙", test_category: "新品提案", version_change: "第三项", status: "待处理", created_at: "2026-08-28T02:00:04.000Z", updated_at: "2026-08-28T02:00:04.000Z" },
  { id: "legacy-0", supplier_name: "百嘉宜", product_name: "莓果山楂蛋糕", version_label: "V3", sample_date: "2026-08-27", product_type: "蛋糕", test_category: "档期测试", status: "待处理", created_at: "2026-08-27T02:00:00.000Z", updated_at: "2026-08-27T02:00:00.000Z" },
  { id: "a-old", submission_batch_id: "batch-a-old", batch_item_index: 0, supplier_name: "佰翔空厨食品有限公司", product_name: "旧日送样蛋糕", version_label: "V1", sample_date: "2026-08-20", product_type: "蛋糕", test_category: "新品提案", status: "待处理", created_at: "2026-08-26T02:00:00.000Z", updated_at: "2026-08-26T02:00:00.000Z" },
  { id: "confirmed-0", submission_batch_id: "old-batch", batch_item_index: 0, supplier_name: "供应商 B", product_name: "已确认产品", version_label: "V1", product_type: "蛋糕", test_category: "新品提案", status: "已确认", created_at: "2026-08-20T02:00:00.000Z", updated_at: "2026-08-20T02:00:00.000Z" },
  { id: "cny-old", supplier_name: "供应商 C", product_name: "旧名产品", version_label: "V1", product_type: "蛋糕", test_category: "档期测试", campaign_year: "2027", campaign: "01月｜CNY", ingredients_structure: "第1层｜最底层：饼干底 20g（20%）\n第2层：芝士慕斯 80g（80%）\n自动计算总克重：100g", status: "已确认", created_at: "2026-08-19T02:00:00.000Z", updated_at: "2026-08-19T02:00:00.000Z" },
  { id: "cny-standard", supplier_name: "供应商 D", product_name: "标准名产品", version_label: "V1", product_type: "三明治", test_category: "档期测试", campaign_year: "2027", campaign: "01月｜CNY（含烘焙 / 三明治换新）", status: "已确认", created_at: "2026-08-18T02:00:00.000Z", updated_at: "2026-08-18T02:00:00.000Z" }
];

let server;
let browser;
let page;
let baseUrl;
let records;

function contentType(pathname) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[extname(pathname)] || "application/octet-stream";
}

test.before(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relativePath = normalize(pathname).replace(/^[/\\]+/, "");
      const filePath = join(repoRoot, relativePath || "index.html");
      if (!filePath.startsWith(`${repoRoot}/`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolveClose => server?.close(resolveClose));
});

test.beforeEach(async () => {
  records = structuredClone(seedRecords);
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route("https://cdn.jsdelivr.net/**", route => route.abort());
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    sessionStorage.setItem("categorylabCloudbaseAdminCode", "test-only");
    localStorage.setItem("burger-bom-tool-v1", JSON.stringify({
      devRecords: [{ supplierSubmissionId: "confirmed-0" }]
    }));
  });
  await page.route("**/api/supplier-feedback", async route => {
    const body = route.request().postDataJSON();
    if (body.action === "adminLogin") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { profile: { role: "owner" } } }) });
      return;
    }
    if (body.action === "adminList") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { records } })
      });
      return;
    }
    if (body.action === "adminUpdate") {
      const index = records.findIndex(row => row.id === body.id);
      records[index] = { ...records[index], ...body.payload, updated_at: "2026-09-01T04:00:00.000Z" };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { record: records[index] } })
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: `Unexpected action: ${body.action}` })
    });
  });
  await page.goto(`${baseUrl}${inboxPath}?backend=cloudbase`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-pending-supplier-key]").first().waitFor();
});

test.afterEach(async () => {
  await page?.close();
});

test("pending view groups only by supplier and lists products in submission order", async () => {
  assert.equal(await page.locator("[data-pending-supplier-key]").count(), 2);
  assert.equal(await page.locator("[data-submission-batch-key]").count(), 0);
  const supplierGroups = page.locator("[data-pending-supplier-key]");
  assert.deepEqual(await supplierGroups.locator(".pending-supplier-name").allTextContents(), ["佰翔空厨食品有限公司", "百嘉宜"]);
  assert.deepEqual(
    await supplierGroups.first().locator("[data-record-id]").evaluateAll(elements => elements.map(element => element.dataset.recordId)),
    ["a-0", "a-1", "a-2", "a-old"]
  );
  assert.deepEqual(await supplierGroups.last().locator("[data-record-id]").evaluateAll(elements => elements.map(element => element.dataset.recordId)), ["legacy-0"]);
  assert.match(await supplierGroups.first().locator(".pending-supplier-meta").innerText(), /4 个产品/);
  assert.equal(await page.locator("#submissionList .submission-batch-head, #submissionList .item-time").count(), 0);
  assert.doesNotMatch(await supplierGroups.first().locator(".pending-supplier-meta").innerText(), /次提交/);
});

test("a supplier section can collapse across dates without hiding another supplier", async () => {
  const supplier = page.locator("[data-pending-supplier-key]").first();
  await supplier.locator("[data-pending-supplier-toggle]").click();
  assert.equal(await supplier.locator("[data-pending-supplier-toggle]").getAttribute("aria-expanded"), "false");
  assert.equal(await supplier.locator('[data-record-id="a-0"]').isVisible(), false);
  assert.equal(await page.locator('[data-record-id="legacy-0"]').isVisible(), true);
  await supplier.locator("[data-pending-supplier-toggle]").click();
  assert.equal(await supplier.locator('[data-record-id="a-old"]').isVisible(), true);
});

test("supplier headings and product rows fit a narrow inbox", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const headings = await page.locator(".pending-supplier-head, .pending-batch-item").evaluateAll(elements =>
    elements.map(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth }))
  );
  assert.ok(headings.every(heading => heading.contentWidth <= heading.width + 1));
  if (process.env.CATEGORYLAB_VISUAL_CHECK) {
    await page.screenshot({ path: "/tmp/categorylab-pending-suppliers-mobile.png", fullPage: true });
  }
});

test("pending product search shows only matching products", async () => {
  await page.locator("#searchInput").fill("黑豆松子");
  assert.deepEqual(await page.locator("#submissionList [data-record-id]").evaluateAll(elements => elements.map(element => element.dataset.recordId)), ["a-1"]);
});

test("pending supplier search keeps all of that supplier's submission dates", async () => {
  await page.locator("#searchInput").fill("佰翔空厨");
  assert.equal(await page.locator("[data-pending-supplier-key]").count(), 1);
  assert.deepEqual(
    await page.locator("#submissionList [data-record-id]").evaluateAll(elements => elements.map(element => element.dataset.recordId)),
    ["a-0", "a-1", "a-2", "a-old"]
  );
});

test("confirmation advances through a supplier's products before moving to another supplier", async () => {
  await page.locator('[data-record-id="a-0"]').click();
  await page.locator("[data-confirm-active]").click();
  await page.locator('[data-record-id="a-1"].active').waitFor();
  assert.match(await page.locator('[data-pending-supplier-key]').first().locator('.pending-supplier-meta').innerText(), /3 个产品/);
  assert.equal(await page.locator('[data-record-id="a-0"]').count(), 0);
  assert.equal(await page.locator('[data-status-filter="待处理"].active').count(), 1);

  await page.locator("[data-confirm-active]").click();
  await page.locator('[data-record-id="a-2"].active').waitFor();
  await page.locator("[data-confirm-active]").click();
  await page.locator('[data-record-id="a-2"]').waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-record-id="a-old"].active').count(), 1);
  assert.equal(await page.locator("[data-pending-supplier-key]").count(), 2);
  await page.locator("[data-confirm-active]").click();
  await page.locator('[data-record-id="a-old"]').waitFor({ state: "detached" });
  assert.equal(await page.locator("[data-pending-supplier-key]").count(), 1);
  assert.equal(await page.locator('[data-record-id="legacy-0"]').count(), 1);
});

test("processed and all views continue to use product grouping", async () => {
  await page.locator('[data-status-filter="已确认"]').click();
  assert.equal(await page.locator("[data-pending-supplier-key]").count(), 0);
  assert.equal(await page.locator("[data-submission-batch-key]").count(), 0);
  assert.equal(await page.locator("[data-product-group-key]").count(), 3);

  assert.equal(await page.locator('[data-status-filter="已导入"]').count(), 0);

  await page.locator('[data-status-filter=""]').click();
  assert.equal(await page.locator("[data-pending-supplier-key]").count(), 0);
  assert.equal(await page.locator("[data-submission-batch-key]").count(), 0);
  assert.ok(await page.locator("[data-product-group-key]").count() >= 1);
});

test("company and selected product use different hierarchy colors", async () => {
  const company = page.locator("[data-pending-supplier-key]").first();
  const product = company.locator('[data-record-id="a-0"]');
  await product.click();
  assert.equal(
    await company.locator(".pending-supplier-head").evaluate(element => getComputedStyle(element).backgroundColor),
    "rgb(243, 239, 230)"
  );
  assert.equal(await product.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(231, 239, 229)");
});

test("middle detail headings render as title bars", async () => {
  assert.ok(await page.locator(".section-title-bar").count() >= 3);
  assert.deepEqual(await page.locator(".section-title-bar").allTextContents(), [
    "供应商提交内容",
    "本版调整点",
    "产品经理补充测试结果"
  ]);
});

test("FY27 CNY aliases render as one campaign section", async () => {
  await page.locator('[data-status-filter="已确认"]').click();
  assert.equal(await page.locator("[data-campaign-group-section]").count(), 1);
  assert.match(await page.locator("[data-campaign-group]").innerText(), /01月｜CNY（含烘焙 \/ 三明治换新）/);
});

test("product structure keeps one visual line per stored layer", async () => {
  await page.locator('[data-status-filter="已确认"]').click();
  await page.locator('[data-record-id="cny-old"]').click();
  assert.deepEqual(await page.locator("[data-structure-line]").allTextContents(), [
    "第1层｜最底层：饼干底 20g（20%）",
    "第2层：芝士慕斯 80g（80%）",
    "自动计算总克重：100g"
  ]);
});
