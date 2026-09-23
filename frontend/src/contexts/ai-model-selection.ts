import type { AiModel } from '../services/ai.service';

export type AiModelMode = 'standard' | 'deep';
export type AiModelPreference = { id?: string; mode?: AiModelMode };

/** Old IDs describe a preference only; they never authorize sending an unavailable model. */
export function legacyModelMode(id?: string): AiModelMode | undefined {
  const family = id?.match(/^gemini-(?:1\.5|2\.0|2\.5)-(pro|flash(?:-lite)?)(?:-|$)/)?.[1];
  return family === 'pro' ? 'deep' : family ? 'standard' : undefined;
}

export function aiModelMode(model: AiModel): AiModelMode | undefined {
  return model.mode ?? legacyModelMode(model.id);
}

export function readModelPreference(id: string | null, mode: string | null): AiModelPreference {
  const modelId = id?.trim() || undefined;
  return { id: modelId, mode: mode === 'standard' || mode === 'deep' ? mode : legacyModelMode(modelId) };
}

/** Select only an ID present in the current server response, including for older APIs without mode. */
export function resolveAiModel(models: AiModel[], preference: AiModelPreference): AiModel | undefined {
  return models.find(model => model.id === preference.id)
    ?? models.find(model => aiModelMode(model) === (preference.mode ?? 'standard'))
    ?? models.find(model => aiModelMode(model) === 'standard')
    ?? models[0];
}
