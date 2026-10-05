const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/src/modules/ai/knowledge/catalog.source.json'), 'utf8'));
const ids = ['mailroom-workbench', 'personal-inbox', 'after-sales-customer-workbench', 'after-sales-native-cases'];
const entries = ids.map(id => {
  const entry = source.entries.find(value => value.id === id);
  assert(entry, `Missing operating guide ${id}`);
  return entry;
});
function text(entry, locale) {
  const sections = locale === 'en' ? entry.translations.en.sections : entry.sections;
  return [...sections.steps, ...sections.boundaries].join('\n');
}

test('both languages explain personal intake acceptance and the same-receipt source link', () => {
  for (const entry of entries) {
    for (const locale of ['zh-TW', 'en']) {
      const content = text(entry, locale);
      assert.match(content, /SENT/);
      assert.match(content, /ACCEPTED/);
      assert.match(content, /RESOLVED/);
      assert.match(content, /NativeID/);
      assert.match(content, /RECEIVED/);
      assert.match(content, /REPAIR/);
      assert.match(content, /RETURN/);
      assert.match(content, /lastAction/);
      assert.match(content, /lastRequestId/);
      assert.match(content, /bind_intake/);
    }
  }
  for (const id of ['mailroom-workbench', 'after-sales-customer-workbench', 'after-sales-native-cases']) {
    const entry = entries.find(value => value.id === id);
    for (const locale of ['zh-TW', 'en']) assert.match(text(entry, locale), /\/cases\/new/);
  }
  const csr = entries.find(value => value.id === 'after-sales-customer-workbench');
  assert.match(text(csr, 'zh-TW'), /指定客服本人/);
  assert.match(text(csr, 'en'), /Only the assigned CSR/);
});

test('intake guidance distinguishes custody, source authority and unknown-result reconciliation', () => {
  const mailroom = entries.find(value => value.id === 'mailroom-workbench');
  const zh = text(mailroom, 'zh-TW');
  const en = text(mailroom, 'en');
  for (const content of [zh, en]) {
    assert.match(content, /mailroom:review/);
    assert.match(content, /after_sales_cases:read/);
    assert.match(content, /ENTITY/);
    assert.match(content, /requestId/);
  }
  assert.match(zh, /保管人.*位置.*下一位/);
  assert.match(en, /Preserve.*physical custodian.*location.*next physical recipient/);
  assert.match(zh, /不再建立第二張主單/);
  assert.match(en, /do not create a second case/);
  assert.match(zh, /首次內容與 requestId/);
  assert.match(en, /first body and requestId/);
  assert.match(zh, /候選名單不代表已查驗來源帳號/);
  assert.match(en, /candidate list does not prove source-account validation/);
  assert.match(zh, /主管核對.*禁止重登收件或自動拆單/);
  assert.match(en, /supervisor.*without registering receipt again or automatically splitting/);
});

test('intake operating articles cite real reviewed contract and service files', () => {
  const citations = [
    'backend/src/modules/mailroom/mailroom-intake.contract.ts',
    'backend/src/modules/mailroom/mailroom-intake.service.ts',
    'backend/src/modules/mailroom/mailroom.controller.ts',
  ];
  for (const entry of entries) {
    for (const citation of citations) {
      assert(entry.sourcePaths.includes(citation), `${entry.id}: missing ${citation}`);
      const file = path.join(ROOT, citation);
      assert(fs.statSync(file).isFile(), `${entry.id}: citation does not exist`);
    }
  }
});
