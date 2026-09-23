import assert from 'node:assert/strict';
import test from 'node:test';
import { aiModelMode, readModelPreference, resolveAiModel } from '../src/contexts/ai-model-selection';
import type { AiModel } from '../src/services/ai.service';

const models: AiModel[] = [
  { id: 'server-standard-model', name: 'Standard', mode: 'standard' },
  { id: 'server-deep-model', name: 'Deep', mode: 'deep' },
];

test('old Gemini deep preferences resolve to the server deep mode without a version fallback', () => {
  for (const id of ['gemini-1.5-pro', 'gemini-2.0-pro', 'gemini-2.5-pro', 'gemini-1.5-pro-002']) {
    assert.equal(resolveAiModel(models, readModelPreference(id, null))?.id, 'server-deep-model');
  }
});

test('old Gemini flash preferences and a fresh install select server standard mode', () => {
  for (const id of [null, 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-lite']) {
    assert.equal(resolveAiModel([...models].reverse(), readModelPreference(id, null))?.id, 'server-standard-model');
  }
});

test('an exact server-listed selection is retained and its declared mode is authoritative', () => {
  assert.equal(resolveAiModel(models, { id: 'server-deep-model' })?.id, 'server-deep-model');
  assert.equal(aiModelMode({ id: 'gemini-2.5-flash', name: 'Renamed deep', mode: 'deep' }), 'deep');
});

test('saved mode survives future model renaming and a temporary reduced model list', () => {
  const preference = readModelPreference('removed-model-id', 'deep');
  assert.equal(resolveAiModel([models[0]], preference)?.id, models[0].id);
  assert.equal(preference.mode, 'deep');
  assert.equal(resolveAiModel(models, preference)?.id, models[1].id);
});

test('older API model lists without mode retain legacy deep and standard selections', () => {
  const old: AiModel[] = [{ id: 'gemini-2.5-flash', name: '標準模式' }, { id: 'gemini-2.5-pro', name: '深度模式' }];
  assert.equal(resolveAiModel(old, readModelPreference('gemini-1.5-pro', null))?.id, 'gemini-2.5-pro');
  assert.equal(resolveAiModel(old, readModelPreference('gemini-2.0-flash', null))?.id, 'gemini-2.5-flash');
});

test('loading or failed model discovery never returns a stored unsupported model ID', () => {
  assert.equal(resolveAiModel([], { id: 'gemini-2.5-pro', mode: 'deep' }), undefined);
  assert.equal(resolveAiModel(models, { id: 'unsupported-model' })?.id, models[0].id);
  assert.equal(resolveAiModel([{ id: 'opaque-server-model', name: 'Available' }], { mode: 'deep' })?.id, 'opaque-server-model');
});
