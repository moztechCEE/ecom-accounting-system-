import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from '../src/types';
import type { AiKnowledgeEntry, AiKnowledgeExample } from '../src/services/ai.service';
import { clawScopeKey, currentKnowledge, currentPageArticle, focusWrapIndex, guideCategories, guideDestination, helpArticleId, requestErrorCode, safeExample, safeGuidePath, selectedArticle } from '../src/components/claw/state';
import { clawText } from '../src/components/claw/copy';

const user: User = { id: 'alice', name: 'Alice', email: 'qa@example.invalid', roles: ['EMPLOYEE', 'FINANCE'], permissions: ['expense_self:read', 'accounts:read'], accountingDataScope: 'ENTITY' };
const article = (id: string, path: string, category = 'Finance'): AiKnowledgeEntry => ({ id, path, title: id, summary: 'Guide', category, sections: [{ title: 'Start', body: 'A safe instruction.' }], examples: [], sources: [], sourceVersion: 'v1' });
const entries = [article('expenses', '/ap/expenses'), article('review', '/ap/expense-review'), article('inventory', '/inventory', 'Warehouse')];
const example: AiKnowledgeExample = { id: 'synthetic', title: 'Sample', filename: 'example.json', contentType: 'application/json', content: '{"company":"QA ONLY"}' };

test('permission scopes reset on account, role, permission and financial scope changes', () => {
  const key = clawScopeKey(user);
  for (const candidate of [{ ...user, id: 'bob' }, { ...user, roles: ['EMPLOYEE'] }, { ...user, permissions: ['expense_self:read'] }, { ...user, accountingDataScope: 'SELF' as const }]) assert.notEqual(clawScopeKey(candidate), key);
  assert.equal(clawScopeKey({ ...user, roles: [...user.roles].reverse(), permissions: [...user.permissions].reverse() }), key);
});

test('entity membership and employee department changes invalidate displayed context', () => {
  const scoped = { ...user, entityMemberships: [{ entityId: 'qa-company', isPrimary: true, entity: { isActive: true } }], employee: { id: 'employee-a', entityId: 'qa-company', departmentId: 'sales' } };
  assert.notEqual(clawScopeKey(scoped), clawScopeKey({ ...scoped, entityMemberships: [{ entityId: 'other-company' }] }));
  assert.notEqual(clawScopeKey(scoped), clawScopeKey({ ...scoped, employee: { ...scoped.employee, departmentId: 'finance' } }));
  assert.notEqual(clawScopeKey(scoped), clawScopeKey({ ...scoped, entityMemberships: [{ entityId: 'qa-company', isPrimary: true, entity: { isActive: false } }] }));
});

test('old or forbidden library responses cannot provide visible articles', () => {
  const old = { key: 'company-a/zh-TW/permissions-v1', data: entries };
  assert.equal(currentKnowledge(old, 'company-b/zh-TW/permissions-v1'), undefined);
  assert.equal(currentKnowledge(old, 'company-a/en/permissions-v1'), undefined);
  assert.equal(currentKnowledge(old, 'company-a/zh-TW/permissions-v2'), undefined);
  assert.equal(currentKnowledge({ key: old.key }, old.key), undefined);
  assert.equal(currentKnowledge(old, old.key), entries);
  assert.equal(selectedArticle(entries, 'restricted-payroll'), null);
  assert.equal(selectedArticle([], 'expenses'), null);
});

test('current page help uses the closest authorized guide without similar-prefix confusion', () => {
  const library = [...entries, article('inventory-products', '/inventory/products', 'Warehouse')];
  assert.equal(currentPageArticle(library, '/inventory/products/item-id')?.id, 'inventory-products');
  assert.equal(currentPageArticle(library, '/inventory/products')?.id, 'inventory-products');
  assert.equal(currentPageArticle(library, '/inventory-other'), null);
  assert.equal(currentPageArticle(entries, '/admin/payroll'), null);
  assert.deepEqual(guideCategories(library), ['Finance', 'Warehouse']);
});

test('navigation refuses external URLs, executable schemes and path traversal', () => {
  assert.equal(safeGuidePath('/ap/expenses'), '/ap/expenses');
  for (const path of ['https://example.invalid', '//example.invalid', 'javascript:alert(1)', '/\\example.invalid', '/../admin', '/%2f%2fevil', '/profile?redirect=https://evil.test', null]) assert.equal(safeGuidePath(path), null);
});

test('page help accepts only an authored article identifier', () => {
  assert.equal(helpArticleId({ article: 'expense-review' }), 'expense-review');
  for (const detail of [{ article: '//evil' }, { article: {} }, { article: '<script>' }, null]) assert.equal(helpArticleId(detail), null);
});

test('staged navigation follows the release flag while documentation and preview pages remain readable', () => {
  const staged = { ...article('after-sales-quotes', '/sales/after-sales/quotes'), availability: 'staged' as const };
  assert.equal(guideDestination(staged, false), null);
  assert.equal(guideDestination(staged, true), staged.path);
  assert.equal(selectedArticle([staged], staged.id), staged);
  assert.equal(guideDestination({ path: '/import', availability: 'preview-only' }, false), '/import');
  assert.equal(guideDestination({ path: '/warehouse/picking', availability: 'wms-portal' }, false), '/warehouse/picking');
});

test('example downloads allow inert JSON/CSV and refuse active formats and unsafe names', () => {
  assert.equal(safeExample(example)?.contentType, 'application/json;charset=utf-8');
  assert.equal(safeExample({ ...example, contentType: 'text/csv', filename: 'synthetic.csv', content: 'id,name\nQA,Test' })?.filename, 'synthetic.csv');
  for (const filename of ['../example.json', '..\\example.json', '.hidden.json', 'bad\u0000.json', 'example.html']) assert.equal(safeExample({ ...example, filename }), null);
  assert.equal(safeExample({ ...example, contentType: 'text/html' }), null);
  assert.equal(safeExample({ ...example, content: 'not-json' }), null);
  assert.equal(safeExample({ ...example, content: 'x'.repeat(1_000_001) }), null);
});

test('auth and provider failures retain distinct safe messages in both languages', () => {
  assert.equal(requestErrorCode({ response: { status: 401 } }), 'unauthorized');
  assert.equal(requestErrorCode({ response: { status: 403 } }), 'forbidden');
  assert.equal(requestErrorCode({ response: { status: 400 } }), 'invalid');
  assert.equal(requestErrorCode(new Error('raw provider data')), 'unavailable');
  assert.notEqual(clawText('zh-TW', 'aiOffline'), clawText('en', 'aiOffline'));
  assert.match(clawText('en', 'aiOffline'), /guides are still available/);
});

test('mobile focus wraps at both boundaries and recovers focus outside the dialog', () => {
  assert.equal(focusWrapIndex(5, 4, false), 0);
  assert.equal(focusWrapIndex(5, 0, true), 4);
  assert.equal(focusWrapIndex(5, -1, true), 4);
  assert.equal(focusWrapIndex(5, -1, false), 0);
  assert.equal(focusWrapIndex(5, 2, false), null);
  assert.equal(focusWrapIndex(0, -1, true), null);
});
