import { describe, expect, it } from 'vitest';

import { getSessionModelId, restoreSessionModelPreference } from '@/providers/opencode-model-selection';

describe('session model selection', () => {
  it('reads the OpenCode 2 session model shape', () => {
    expect(getSessionModelId({ model: { providerID: 'openai', id: 'gpt-6.1-sol' } })).toBe('openai/gpt-6.1-sol');
  });

  it('accepts compatible modelID and qualified string shapes', () => {
    expect(getSessionModelId({ model: { providerID: 'deepseek', modelID: 'deepseek-v4-pro' } })).toBe('deepseek/deepseek-v4-pro');
    expect(getSessionModelId({ model: 'openai/gpt-5.6-sol' })).toBe('openai/gpt-5.6-sol');
  });

  it('rejects incomplete server model data', () => {
    expect(getSessionModelId({ model: { id: 'gpt' } })).toBeUndefined();
    expect(getSessionModelId({ model: 'gpt' })).toBeUndefined();
    expect(getSessionModelId(undefined)).toBeUndefined();
  });

  it('restores a catalog-backed session model without changing other preferences', () => {
    const current = { providerId: 'deepseek', modelId: 'deepseek/v4', providerModelSelections: { deepseek: 'deepseek/v4' }, reasoning: 'high' } as never;
    const models = [{ id: 'openai/gpt-6.1-sol', providerID: 'openai' }] as never;
    expect(restoreSessionModelPreference(current, { model: { providerID: 'openai', id: 'gpt-6.1-sol' } }, models)).toEqual({
      providerId: 'openai', modelId: 'openai/gpt-6.1-sol',
      providerModelSelections: { deepseek: 'deepseek/v4', openai: 'openai/gpt-6.1-sol' }, reasoning: 'high',
    });
  });

  it('keeps the current selection when server data is absent or not enabled', () => {
    const current = { providerId: 'deepseek', modelId: 'deepseek/v4', providerModelSelections: {} } as never;
    expect(restoreSessionModelPreference(current, {}, [])).toBe(current);
    expect(restoreSessionModelPreference(current, { model: { providerID: 'openai', id: 'missing' } }, [])).toBe(current);
  });
});
