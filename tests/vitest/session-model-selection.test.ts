import { describe, expect, it } from 'vitest';

import { getSessionModelId, getSessionSelection, restoreSessionModelPreference } from '@/providers/opencode-model-selection';
import * as selection from '@/providers/opencode-model-selection';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

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

  it('retains separate unsent choices in two chats, then restores the server model after relaunch', () => {
    const models = [{ id: 'openai/gpt-a' }, { id: 'deepseek/v4' }] as never;
    const choices = new Map<string, string>();
    const a = { model: { providerID: 'openai', id: 'gpt-a' } };
    const b = { model: { providerID: 'openai', id: 'gpt-a' } };
    expect(getSessionSelection(choices, 'server/project/a', a, models)).toBe('openai/gpt-a');
    choices.set('server/project/a', 'deepseek/v4'); // A chooses but has not sent
    expect(getSessionSelection(choices, 'server/project/b', b, models)).toBe('openai/gpt-a');
    expect(getSessionSelection(choices, 'server/project/a', a, models)).toBe('deepseek/v4');
    expect(getSessionSelection(new Map(), 'server/project/a', { model: { providerID: 'deepseek', id: 'v4' } }, models)).toBe('deepseek/v4');
  });

  it('pins an empty new chat to its initial choice while switching away', () => {
    const choices = new Map<string, string>();
    const models = [{ id: 'openai/gpt-a' }, { id: 'deepseek/v4' }] as never;
    expect(getSessionSelection(choices, 'new', {}, models, 'openai/gpt-a')).toBeUndefined();
    expect(getSessionSelection(choices, 'new', {}, models, 'deepseek/v4')).toBe('openai/gpt-a');
  });
});

it('drives actual provider model actions across two chats without a send', async () => {
  const runtime = hookRuntime();
  const { useCapabilitiesActions } = await loadTs('providers/use-capabilities-actions.ts', {
    react: runtime.react,
    '@/providers/opencode-model-selection': selection,
    '@/providers/opencode-capabilities': { isAutoApproveEnabled: () => false, mergePermissionConfig: () => ({}) },
  });
  const models = [
    { id: 'openai/a', providerID: 'openai' },
    { id: 'deepseek/b', providerID: 'deepseek' },
  ];
  const sessions = [
    { id: 'a', model: { providerID: 'openai', id: 'a' } },
    { id: 'b', model: { providerID: 'deepseek', id: 'b' } },
  ];
  function Driver(props: { currentSessionId: string }) {
    const [chatPreferences, setChatPreferences] = runtime.react.useState({
      providerId: 'openai', modelId: 'openai/a', enabledModelIds: ['openai/a', 'deepseek/b'],
      providerModelSelections: {}, recentModelIds: [],
    });
    const actions = useCapabilitiesActions({
      ...props, chatPreferences, setChatPreferences, connectionScope: 'server', activeProjectPath: '/repo',
      sessions, availableModels: models, availableProviders: [
        { id: 'openai', configured: true }, { id: 'deepseek', configured: true },
      ], client: {}, isCurrentClient: () => true,
    });
    return { chatPreferences, actions };
  }
  runtime.mount(Driver, { currentSessionId: 'a' });
  runtime.value.actions.updateChatPreferences({ providerId: 'deepseek', modelId: 'deepseek/b' });
  runtime.flush();
  expect(runtime.value.chatPreferences.modelId).toBe('deepseek/b');
  runtime.update({ currentSessionId: 'b' });
  expect(runtime.value.chatPreferences.modelId).toBe('deepseek/b');
  runtime.value.actions.updateChatPreferences({ providerId: 'openai', modelId: 'openai/a' });
  runtime.flush();
  runtime.update({ currentSessionId: 'a' });
  expect(runtime.value.chatPreferences.modelId).toBe('deepseek/b');
  runtime.update({ currentSessionId: 'b' });
  expect(runtime.value.chatPreferences.modelId).toBe('openai/a');
});
