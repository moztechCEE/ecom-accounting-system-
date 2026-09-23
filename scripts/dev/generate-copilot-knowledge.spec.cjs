const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const DIR = 'backend/src/modules/ai/knowledge';
const SCRIPT = 'scripts/dev/generate-copilot-knowledge.cjs';
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, DIR, 'source-manifest.json'), 'utf8'));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-knowledge-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [SCRIPT, `${DIR}/catalog.source.json`, `${DIR}/legacy-entries.json`, `${DIR}/catalog.generated.ts`, `${DIR}/source-manifest.json`, ...manifest.sources.map((source) => source.path)];
  for (const file of new Set(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
  }
  return root;
}
function run(root, mode = '--check') {
  const result = spawnSync(process.execPath, [path.join(root, SCRIPT), mode], { encoding: 'utf8' });
  return { code: result.status, output: result.stdout + result.stderr };
}
function edit(root, change) {
  const file = path.join(root, DIR, 'catalog.source.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
test('reviewed catalog passes bilingual, route, original-ID and hash checks without writes', (t) => {
  const root = fixture(t);
  const before = fs.readFileSync(path.join(root, DIR, 'source-manifest.json'), 'utf8');
  const result = run(root);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /55 bilingual guides, 9 groups, 64 routes/);
  assert.equal(fs.readFileSync(path.join(root, DIR, 'source-manifest.json'), 'utf8'), before);
});
test('changed reviewed implementation fails read-only drift check and names the source', (t) => {
  const root = fixture(t);
  const before = fs.readFileSync(path.join(root, DIR, 'source-manifest.json'), 'utf8');
  fs.appendFileSync(path.join(root, 'frontend/src/pages/AccountsPage.tsx'), '\n// Synthetic changed behavior\n');
  const result = run(root);
  assert.equal(result.code, 1);
  assert.match(result.output, /Knowledge drift/);
  assert.match(result.output, /frontend\/src\/pages\/AccountsPage.tsx/);
  assert.equal(fs.readFileSync(path.join(root, DIR, 'source-manifest.json'), 'utf8'), before);
});
test('a newly exposed route cannot be silently omitted even during regeneration', (t) => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, 'frontend/src/App.tsx'), '\n<Route path="new-feature" element={null} />\n');
  const result = run(root, '--write');
  assert.equal(result.code, 1);
  assert.match(result.output, /Routes without a guide: \/new-feature/);
});
test('missing English boundaries are rejected', (t) => {
  const root = fixture(t);
  edit(root, (data) => { data.entries[0].translations.en.sections.boundaries = []; });
  const result = run(root, '--write');
  assert.equal(result.code, 1);
  assert.match(result.output, /en.boundaries/);
});
test('removing an original guide fails even when its route is covered by another article', (t) => {
  const root = fixture(t);
  edit(root, (data) => {
    data.entries = data.entries.filter((entry) => entry.id !== 'dashboard');
    for (const entry of data.entries) for (const sections of [entry.sections, entry.translations.en.sections]) sections.related = sections.related.filter((id) => id !== 'dashboard');
    data.entries[0].aliases = [...(data.entries[0].aliases || []), '/dashboard'];
  });
  const result = run(root, '--write');
  assert.equal(result.code, 1);
  assert.match(result.output, /Lost original guide dashboard/);
});
test('reviewed correction to an original summary is allowed and versions change', (t) => {
  const root = fixture(t);
  const before = JSON.parse(fs.readFileSync(path.join(root, DIR, 'source-manifest.json'), 'utf8')).sourceVersion;
  edit(root, (data) => { data.entries[0].summary += '（已核對來源。）'; });
  assert.equal(run(root, '--write').code, 0);
  assert.equal(run(root).code, 0);
  const after = JSON.parse(fs.readFileSync(path.join(root, DIR, 'source-manifest.json'), 'utf8')).sourceVersion;
  assert.notEqual(after, before);
});
test('unknown related articles and duplicate IDs are rejected', (t) => {
  const root = fixture(t);
  edit(root, (data) => { data.entries[0].sections.related.push('missing-article'); });
  assert.match(run(root, '--write').output, /unknown related ID/);
  edit(root, (data) => { data.entries[0].sections.related.pop(); data.entries.push(data.entries[0]); });
  assert.match(run(root, '--write').output, /Duplicate guide ID/);
});
test('example CSV cells cannot contain spreadsheet formulas', (t) => {
  const root = fixture(t);
  edit(root, (data) => { data.entries.find((entry) => entry.id === 'import-preview').examples[0].content = 'name,amount\n=1+1,100\n'; });
  const result = run(root, '--write');
  assert.equal(result.code, 1);
  assert.match(result.output, /CSV formula injection/);
});
test('a reviewed-source path cannot escape the checkout', (t) => {
  const root = fixture(t);
  edit(root, (data) => { data.entries[0].sourcePaths.push('../outside-secret'); });
  const result = run(root, '--write');
  assert.equal(result.code, 1);
  assert.match(result.output, /Unsafe source path/);
});
