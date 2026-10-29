import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
const module = { exports: {} };
const source = readFileSync(new URL('../src/pages/repair/RepairTestStandardManager.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source + '\nexport const __test = {definition,calibration,registry,receipt,products};', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function('module', 'exports', 'require', code)(module, module.exports, specifier => {
  if (['react', 'antd', 'react/jsx-runtime'].includes(specifier)) return {};
  if (specifier === '../../services/api') return { default: { get() { throw Error('Unexpected network'); }, post() { throw Error('Unexpected network'); } } };
  if (specifier === '../mailroom/model') return { errorText: () => 'No network' };
  if (specifier === './repair-feedback') return { useRepairFeedback() { throw Error('Unexpected UI'); } };
  throw Error('Unexpected dependency ' + specifier);
});
const { definition, calibration, registry, receipt, products } = module.exports.__test;
const checks = () => [{ key: 'synthetic-voltage', name: 'SYNTHETIC voltage', requiredForInspection: true,
  requiredForCompletion: false, requiresCalibration: true, equipmentType: 'synthetic-meter',
  standard: { kind: 'NUMBER', instruction: 'SYNTHETIC laboratory condition', unit: 'fixture-unit', min: '-1.200000', max: '1.250001' } }];
const standard = () => ({ id: 'server-standard', entityId: 'company', productId: 'actual-product', sku: 'ACTUAL-SKU',
  createdById: 'technician', revision: 1, status: 'DRAFT', data: { checks: checks() }, contentHash: 'a'.repeat(64), reviewedById: null, reviewedAt: null });
const proof = () => ({ id: 'server-calibration', entityId: 'company', instrumentId: 'actual-meter',
  equipmentType: 'synthetic-meter', proofReference: 'ACTUAL certificate reference', status: 'VALID',
  validFrom: '2026-10-01T08:00:00+08:00', validUntil: '2027-10-01T08:00:00+08:00' });
test('numeric strings and actual false flags survive a standard draft without invented defaults', () => {
  assert.deepEqual(definition({ modelNumber: 'ACTUAL model', checks: checks() }), { modelNumber: 'ACTUAL model', checks: checks() });
  const boolean = checks(); boolean[0].standard = { kind: 'BOOLEAN', instruction: 'Actual functional condition', expected: false };
  boolean[0].requiresCalibration = false;
  const result = definition({ checks: boolean });
  assert.equal(result.checks[0].standard.expected, false); assert.equal(result.checks[0].requiredForCompletion, false);
  assert.equal('equipmentType' in result.checks[0], false);
});
test('missing actual standards, duplicate keys and coerced booleans cannot become a draft', () => {
  for (const mutate of [rows => rows[0].requiredForInspection = 'false', rows => delete rows[0].requiredForCompletion,
    rows => rows[0].requiresCalibration = 'true', rows => rows[0].equipmentType = '', rows => rows.push(rows[0]),
    rows => rows[0].standard.instruction = '', rows => rows[0].standard.min = '1.2000001',
    rows => rows[0].standard.min = '2', rows => { delete rows[0].standard.min; delete rows[0].standard.max; }]) {
    const rows = checks(); mutate(rows); assert.throws(() => definition({ checks: rows }));
  }
  assert.throws(() => definition({ checks: [] }));
});
test('calibration stores explicit evidence and honest intervals without a manufactured valid period', () => {
  const raw = proof(); const { instrumentId, equipmentType, proofReference, validFrom, validUntil } = raw;
  assert.deepEqual(calibration(raw, Date.parse('2026-10-13T00:00:00Z')), { instrumentId, equipmentType, proofReference, validFrom, validUntil });
  for (const change of [{ proofReference: '' }, { validFrom: '2026-02-30T00:00:00Z' },
    { validFrom: '2027-01-01T00:00:00Z' }, { validUntil: validFrom }, { validUntil: undefined }])
    assert.throws(() => calibration({ ...raw, ...change }, Date.parse('2026-10-13T00:00:00Z')));
});
test('registry reads reject wrong company/product and preserve server draft versus reviewed status', () => {
  assert.equal(registry({ standards: [standard()], calibrations: [proof()] }, 'company', 'actual-product').standards[0].status, 'DRAFT');
  for (const change of [{ entityId: 'other-company' }, { productId: 'other-product' }, { status: ['DRAFT'] },
    { status: 'REVIEWED' }, { contentHash: 'invalid' }])
    assert.throws(() => registry({ standards: [{ ...standard(), ...change }], calibrations: [] }, 'company', 'actual-product'));
  assert.throws(() => registry({ standards: [], calibrations: [{ ...proof(), entityId: 'other' }] }, 'company', 'actual-product'));
  assert.throws(() => registry({}, 'company', 'actual-product'));
});
test('only real matching revision/status receipts authorize a displayed management result', () => {
  assert.doesNotThrow(() => receipt({ id: 'server-standard', revision: 2, status: 'DRAFT', duplicate: false }, 'DRAFT', undefined, 2));
  for (const value of [{ id: 'server-standard', revision: 2, status: 'DRAFT' }, { id: 'foreign', revision: 2, status: 'REVIEWED', contentHash: 'a'.repeat(64) },
    { id: 'server-standard', createdById: 'technician', revision: 1, status: 'REVIEWED', contentHash: 'a'.repeat(64) },
    { id: 'server-standard', revision: 2, status: 'REVIEWED', contentHash: 'a'.repeat(64), duplicate: 'true' }])
    assert.throws(() => receipt(value, 'REVIEWED', 'server-standard', 2));
  assert.doesNotThrow(() => receipt({ id: 'server-standard', revision: 2, status: 'REVIEWED', contentHash: 'a'.repeat(64) }, 'REVIEWED', 'server-standard', 2));
});

test('catalog results keep optional empty models honest and reject malformed product identities', () => {
  assert.deepEqual(products({products:[{id:'catalog-product',name:'Actual catalog product',sku:'ACTUAL',modelNumber:''}],hasMore:false}), [{id:'catalog-product',name:'Actual catalog product',sku:'ACTUAL',modelNumber:null}]);
  for(const productsValue of [[{id:'actual',name:'Product',sku:''}], [{id:'actual',name:'Product',sku:'SKU',modelNumber:17}], [{id:'same',name:'A',sku:'A'},{id:'same',name:'B',sku:'B'}]]) assert.throws(()=>products({products:productsValue,hasMore:false}));
  assert.throws(()=>products({products:[]}));
});
test('append-only draft and revision receipts require a new identity and next revision', () => {
  assert.throws(()=>receipt({id:'old',revision:2,status:'DRAFT'},'DRAFT',undefined,2,'old'));
  assert.throws(()=>receipt({id:'new',revision:1,status:'DRAFT'},'DRAFT',undefined,2,'old'));
  assert.doesNotThrow(()=>receipt({id:'new',revision:2,status:'DRAFT'},'DRAFT',undefined,2,'old'));
});
