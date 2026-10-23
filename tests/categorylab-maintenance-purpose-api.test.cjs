const assert = require('node:assert/strict');
const test = require('node:test');
const { _private: api } = require('../cloudbase/functions/supplierFeedbackApi/index');

test('PM can save either maintenance purpose or clear it without changing other fields', () => {
  for (const value of ['产品改进', '产品复制', null]) {
    assert.deepEqual(api.normalizeAdminUpdatePayload({ maintenance_purpose: value }), { maintenance_purpose: value });
  }
  assert.deepEqual(api.normalizeAdminUpdatePayload({ campaign: '01月｜优胜美地' }), { campaign: '01月｜优胜美地' });
  assert.throws(() => api.normalizeAdminUpdatePayload({ maintenance_purpose: '其他' }), /测试目的/);
});

test('supplier input and response exclude internal campaign and maintenance intent', () => {
  const internal = { campaign_year: '2027', campaign: '01月｜优胜美地', maintenance_purpose: '产品复制' };
  const payload = api.sanitizePublicSubmissionPayload({ product_name: '示例', test_category: "Peet's老品维护", ...internal });
  const response = api.publicSubmissionRecord({ id: 'example', test_category: 'Ora特殊测试', ...internal });
  for (const key of Object.keys(internal)) {
    assert.equal(Object.hasOwn(payload, key), false);
    assert.equal(Object.hasOwn(response, key), false);
  }
  assert.equal(payload.test_category, "Peet's老品维护");
  assert.equal(response.test_category, 'Ora特殊测试');
});

test('manual grouping rejects different brands while allowing same-brand versions', () => {
  const row = { supplier_name: '同一供应商', test_category: "Peet's档期测试" };
  assert.throws(() => api.validateProductGroupingRecords([row, { ...row, test_category: 'Ora档期测试' }]), /品牌/);
  assert.equal(api.validateProductGroupingRecords([row, { ...row, test_category: "Peet's老品维护" }]), true);
});


test('project names are PM-only and partial updates preserve unrelated record fields', () => {
  assert.deepEqual(api.normalizeAdminUpdatePayload({ project_name: '  早餐系列  ' }), { project_name: '早餐系列' });
  assert.deepEqual(api.normalizeAdminUpdatePayload({ project_name: '' }), { project_name: null });
  assert.deepEqual(api.normalizeAdminUpdatePayload({ quote_rmb: 8.5 }), { quote_rmb: 8.5 });
  const source = { product_name: '新品', test_category: 'Ora新品测试', project_name: '供应商不应设置' };
  assert.equal(Object.hasOwn(api.sanitizePublicSubmissionPayload(source), 'project_name'), false);
  assert.equal(Object.hasOwn(api.publicSubmissionRecord(source), 'project_name'), false);
  assert.equal(api.sanitizePublicSubmissionPayload(source).test_category, 'Ora新品测试');
});
