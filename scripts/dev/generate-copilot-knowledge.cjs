#!/usr/bin/env node
/** Generate only explicitly reviewed guide sources. Never crawl or index a repository. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const DIR = 'backend/src/modules/ai/knowledge';
const SOURCE = `${DIR}/catalog.source.json`;
const LEGACY = `${DIR}/legacy-entries.json`;
const GENERATED = `${DIR}/catalog.generated.ts`;
const MANIFEST = `${DIR}/source-manifest.json`;
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
function read(relative) {
  assert(!path.isAbsolute(relative) && !relative.split('/').includes('..'), `Unsafe source path: ${relative}`);
  assert(/^(frontend\/src\/|backend\/src\/|docs\/copilot\/)/.test(relative), `Unreviewed source area: ${relative}`);
  assert(!/(^|\/)(?:\.env[^/]*|node_modules|dist|secrets?)(\/|$)/i.test(relative), `Prohibited source: ${relative}`);
  const absolute = path.join(ROOT, relative);
  assert(fs.realpathSync(absolute).startsWith(ROOT + path.sep), `Source escapes checkout: ${relative}`);
  return fs.readFileSync(absolute, 'utf8');
}
function fail(message) { throw new Error(message); }
function nonempty(value, label) { assert(typeof value === 'string' && value.trim(), `${label} must be nonempty`); }
function strings(value, label, min = 1) {
  assert(Array.isArray(value) && value.length >= min, `${label} must contain at least ${min} item(s)`);
  value.forEach((item) => nonempty(item, label));
}
function normalizeRoute(value) { return '/' + value.replace(/^\//, '').split('?')[0]; }
function collectAppRoutes(appSource) {
  const app = appSource.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const routes = [];
  const parents = [];
  for (const match of app.matchAll(/<\/?Route\b/g)) {
    const start = match.index;
    if (app[start + 1] === '/') {
      assert(parents.length, 'Unexpected closing Route tag');
      parents.pop();
      continue;
    }
    // JSX element props contain their own tags (and > characters), so find the
    // Route tag's closing bracket outside quoted attributes and JSX expressions.
    let expressionDepth = 0;
    let quote = null;
    let escaped = false;
    let end = start;
    for (; end < app.length; end += 1) {
      const char = app[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') expressionDepth += 1;
      else if (char === '}') expressionDepth -= 1;
      else if (char === '>' && expressionDepth === 0) break;
    }
    assert(end < app.length, 'Unterminated Route tag');
    const tag = app.slice(start, end + 1);
    const segment = tag.match(/\bpath\s*=\s*(["'])(.*?)\1/)?.[2];
    const parent = parents.at(-1) || '/';
    const route = segment === undefined ? parent : segment.startsWith('/')
      ? normalizeRoute(segment)
      : normalizeRoute(`${parent === '/' ? '' : parent}/${segment}`);
    if (segment !== undefined) routes.push(route);
    if (!tag.slice(0, -1).trimEnd().endsWith('/')) parents.push(route);
  }
  assert.equal(parents.length, 0, 'Unclosed Route tag');
  return routes;
}
function routeExists(route, routes) {
  return routes.some((known) => {
    const expected = known.split('/');
    const actual = route.split('/');
    return expected.length === actual.length && expected.every((part, index) => part === actual[index] || (part.startsWith(':') && Boolean(actual[index])));
  });
}
function collectRoutes() {
  const staticRoutes = collectAppRoutes(read('frontend/src/App.tsx'));
  const nav = [...read('frontend/src/config/navigation.ts').matchAll(/key:\s*['"](\/[^'"]+)['"]/g)].map((m) => m[1]).filter((route) => route !== '/warehouse/'); // A concatenated report prefix, not a destination.
  const portal = [...read('frontend/src/config/wms-portal.ts').matchAll(/key:\s*['"](\/warehouse[^'"]*)['"]/g)].map((m) => m[1]);
  const workspaces = read('frontend/src/config/workspaces.ts');
  const reportsSection = workspaces.slice(workspaces.indexOf('WAREHOUSE_REPORTS'));
  const reports = [...reportsSection.matchAll(/key:\s*['"]([^'"]+)['"]/g)].map((m) => '/warehouse/' + m[1]);
  for (const destination of [...nav, ...portal, ...reports]) {
    assert(routeExists(normalizeRoute(destination), staticRoutes), `Configured destination does not resolve to an App route: ${destination}`);
  }
  return { staticRoutes, requiredRoutes: [...new Set([...staticRoutes.filter((r) => r !== '/' && !r.includes(':')), ...nav, ...portal, ...reports])].sort(), portal };
}
function build() {
  const sourceText = read(SOURCE);
  const source = JSON.parse(sourceText);
  const legacyText = read(LEGACY);
  const legacy = JSON.parse(legacyText);
  assert.equal(source.schemaVersion, 1);
  assert.deepEqual(source.locales, ['zh-TW', 'en']);
  assert(/^[a-f0-9]{40}$/.test(source.reviewedBaseCommit), 'A full reviewed base commit is required');
  const entries = source.entries;
  assert(Array.isArray(entries) && entries.length >= 24, 'Missing guides');
  assert.equal(legacy.length, 24, 'Preserve the original 24 guide records');
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.size, entries.length, 'Duplicate guide ID');
  const routeInfo = collectRoutes();
  const covered = new Set();
  const sources = new Map();
  for (const entry of entries) {
    for (const field of ['id','title','summary','category','module','group']) nonempty(entry[field], `${entry.id}.${field}`);
    assert(/^[a-z][a-z0-9-]*$/.test(entry.id), 'Invalid ID');
    strings(entry.keywords, `${entry.id}.keywords`);
    for (const [locale, content] of [['zh-TW', entry], ['en', entry.translations?.en]]) {
      assert(content, `${entry.id}: missing ${locale}`);
      for (const field of ['title','summary','category']) nonempty(content[field], `${entry.id}.${locale}.${field}`);
      strings(content.keywords, `${entry.id}.${locale}.keywords`);
      strings(content.sections?.steps, `${entry.id}.${locale}.steps`);
      strings(content.sections?.boundaries, `${entry.id}.${locale}.boundaries`);
      strings(content.sections?.related, `${entry.id}.${locale}.related`, 0);
      for (const id of content.sections.related) assert(byId.has(id), `${entry.id}: unknown related ID ${id}`);
    }
    assert.deepEqual(entry.sections.related, entry.translations.en.sections.related, `${entry.id}: locale related IDs differ`);
    for (const field of ['permissions','roles']) if (entry[field]) strings(entry[field], `${entry.id}.${field}`);
    if (entry.availability) assert(['staged','wms-portal','preview-only'].includes(entry.availability));
    for (const route of [entry.path, ...(entry.aliases || [])].filter(Boolean)) {
      assert(route.startsWith('/') && !route.startsWith('//') && !/[\r\n#]/.test(route), `${entry.id}: invalid route`);
      const normalized = normalizeRoute(route);
      assert(routeExists(normalized, routeInfo.staticRoutes), `${entry.id}: route does not exist: ${route}`);
      covered.add(route);
      covered.add(normalized);
    }
    strings(entry.sourcePaths, `${entry.id}.sourcePaths`);
    assert(entry.sourcePaths.some((sourcePath) => /(?:Page\.tsx|\.controller\.ts|\/ai\.service\.ts)$/.test(sourcePath)), `${entry.id}: must cite a reviewed implementation`);
    for (const sourcePath of entry.sourcePaths) {
      assert(!sourcePath.startsWith(DIR + '/'), 'Source cycles are not allowed');
      if (!sources.has(sourcePath)) sources.set(sourcePath, sha(read(sourcePath)));
    }
    for (const example of entry.examples || []) {
      assert(['json','csv'].includes(example.format), 'Unsupported example format');
      nonempty(example.title, 'example title'); nonempty(example.titleEn, 'English example title'); nonempty(example.content, 'example content');
      assert(Buffer.byteLength(example.content) <= 8192, 'Example too large');
      if (example.format === 'json') JSON.parse(example.content);
      if (example.format === 'csv') {
        const rows = example.content.trim().split('\n').map((row) => row.split(','));
        assert(rows.every((row) => row.length === rows[0].length), 'Inconsistent example CSV');
        assert(rows.every((row) => row.every((cell) => !/^[=+@-]/.test(cell.trim()))), 'CSV formula injection');
      }
      assert(!/(?:Bearer\s|AIza[0-9A-Za-z_-]{20}|-----BEGIN|(?:password|apiKey|accessToken)"?\s*[:=])/i.test(example.content), 'Do not publish credentials in examples');
    }
  }
  for (const old of legacy) {
    const current = byId.get(old.id);
    assert(current, `Lost original guide ${old.id}`);
    // Keep identity and traceable routes; reviewed prose may correct stale facts.
    const expectedPath = Object.hasOwn(source.legacyPathOverrides || {}, old.id) ? source.legacyPathOverrides[old.id] ?? undefined : old.path;
    assert.equal(current.path, expectedPath, `Unexpected original path change: ${old.id}`);
  }
  const missing = routeInfo.requiredRoutes.filter((route) => !covered.has(route));
  assert.deepEqual(missing, [], `Routes without a guide: ${missing.join(', ')}`);
  const expectedGroups = ['dashboard','sales','service','warehouse','inventory','finance','people','admin','profile'].sort();
  assert.deepEqual([...new Set(entries.map((entry) => entry.group))].sort(), expectedGroups, 'Navigation group coverage incomplete');
  const sortedSources = [...sources].sort(([a],[b]) => a.localeCompare(b)).map(([sourcePath, digest]) => ({ path: sourcePath, sha256: digest }));
  const catalogSha256 = sha(sourceText), legacySha256 = sha(legacyText);
  const sourceVersion = 'sha256:' + sha(JSON.stringify({ catalogSha256, legacySha256, sources: sortedSources }));
  const generatedEntries = entries.map(({ sourcePaths, ...entry }) => ({ ...entry, sources: sourcePaths.map((sourcePath) => ({ path: sourcePath, sha256: sources.get(sourcePath) })), sourceVersion }));
  const manifest = { schemaVersion: 1, sourceVersion, reviewedBaseCommit: source.reviewedBaseCommit, entryCount: entries.length, groups: expectedGroups, locales: source.locales, catalogSha256, legacySha256, coverage: { routes: routeInfo.requiredRoutes, portalRoutes: routeInfo.portal, dynamicRoutes: routeInfo.staticRoutes.filter((route) => route.includes(':')).sort(), excludedRoutes: [{ path: '/', reason: 'Authenticated role-dependent redirect; dashboard and warehouse are documented.' }] }, sources: sortedSources };
  const generated = '// Generated by scripts/dev/generate-copilot-knowledge.cjs --write after source review.\n// Do not edit: static guides do not register live tools or grant permissions.\nimport type { KnowledgeEntry } from \'./types\';\nexport const KNOWLEDGE_SOURCE_VERSION = ' + JSON.stringify(sourceVersion) + ';\nexport const KNOWLEDGE_ENTRIES: KnowledgeEntry[] = ' + JSON.stringify(generatedEntries, null, 2) + ';\n';
  return { manifest, generated };
}
function main(args = process.argv.slice(2)) {
  assert(args.length === 1 && ['--check','--write'].includes(args[0]), 'Usage: node scripts/dev/generate-copilot-knowledge.cjs --check | --write');
  const { manifest, generated } = build();
  const outputs = [[GENERATED, generated], [MANIFEST, json(manifest)]];
  if (args[0] === '--write') {
    for (const [relative, content] of outputs) fs.writeFileSync(path.join(ROOT, relative), content);
    console.log(`Generated ${manifest.entryCount} bilingual guides; ${manifest.coverage.routes.length} routes, ${manifest.sources.length} reviewed sources; ${manifest.sourceVersion}`);
  } else {
    const differences = outputs.filter(([relative, content]) => !fs.existsSync(path.join(ROOT, relative)) || fs.readFileSync(path.join(ROOT, relative), 'utf8') !== content).map(([relative]) => relative);
    if (differences.length) {
      let previous = {};
      try { previous = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST), 'utf8')); } catch {}
      const previousHashes = new Map((previous.sources || []).map((source) => [source.path, source.sha256]));
      const changed = manifest.sources.filter((source) => previousHashes.get(source.path) !== source.sha256).map((source) => source.path);
      fail(`Knowledge drift: ${differences.join(', ')}\nChanged reviewed sources: ${changed.join(', ') || 'catalog content or manifest'}\nReview affected guides, then run --write. No files were changed.`);
    }
    console.log(`Knowledge check passed: ${manifest.entryCount} bilingual guides, ${manifest.groups.length} groups, ${manifest.coverage.routes.length} routes, ${manifest.sources.length} source hashes; original 24 retained with documented corrections.`);
  }
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { build, collectAppRoutes, main };
