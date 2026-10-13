import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { Config, Session } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { isAutoApproveEnabled, mergePermissionConfig } from '@/providers/opencode-capabilities';
import {
  getConfiguredProviderIds,
  getEnabledModelIds,
  getInitialMode,
  getInitialModelId,
  getInitialProviderId,
  getModelIdForProvider,
  getSessionSelection,
  recordRecentModelId,
  restoreSessionModelPreference,
} from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ProviderAuthMethod, ProviderAuthValues, ProviderOption } from '@/providers/opencode-provider-types';
import { readSessionModelSelection, saveSessionModelSelection } from '@/providers/use-opencode-persistence';

type CapabilitiesActionsInput = {
  client: ScopedOpencodeClient;
  activeProjectPath?: string;
  connectionScope: string;
  currentSessionId?: string;
  sessions: Session[];
  setSessions: Dispatch<SetStateAction<Session[]>>;
  chatPreferences: ChatPreferences;
  isCurrentClient: (candidate: object) => boolean;
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  availableAgents: AgentOption[];
  availableModels: ModelOption[];
  setCurrentConfig: Dispatch<SetStateAction<Config | undefined>>;
  setAvailableProviders: Dispatch<SetStateAction<ProviderOption[]>>;
  setProviderAuthMethodsById: Dispatch<SetStateAction<Record<string, ProviderAuthMethod[]>>>;
  setAvailableModels: Dispatch<SetStateAction<ModelOption[]>>;
  setAvailableAgents: Dispatch<SetStateAction<AgentOption[]>>;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
};

export function useCapabilitiesActions({
  client,
  activeProjectPath,
  connectionScope,
  currentSessionId,
  sessions,
  setSessions,
  chatPreferences,
  isCurrentClient,
  currentConfig,
  availableProviders,
  availableAgents,
  availableModels,
  setCurrentConfig,
  setAvailableProviders,
  setProviderAuthMethodsById,
  setAvailableModels,
  setAvailableAgents,
  setChatPreferences,
}: CapabilitiesActionsInput) {
  const selectedBySessionRef = useRef(new Map<string, string>());
  const explicitModelSelectionsRef = useRef(new Set<string>());
  const loadedModelSelectionsRef = useRef(new Set<string>());
  const [modelSelectionRevision, setModelSelectionRevision] = useState(0);
  const agentBySessionRef = useRef(new Map<string, string>());
  const previousAgentSessionRef = useRef<{ key: string; mode: string } | undefined>(undefined);
  const previousModelSessionRef = useRef<{ key: string; modelId?: string } | undefined>(undefined);
  const restoredSessionRef = useRef<string | undefined>(undefined);
  const sessionKey = currentSessionId && activeProjectPath
    ? `${connectionScope}\n${activeProjectPath}\n${currentSessionId}` : undefined;

  useEffect(() => {
    const previous = previousModelSessionRef.current;
    if (previous && previous.key === sessionKey) {
      previous.modelId = chatPreferences.modelId;
      return;
    }
    // A just-created chat may not be in the list yet. Remember its visible
    // choice before the next chat changes the shared preferences object.
    if (previous?.modelId && !selectedBySessionRef.current.has(previous.key)) {
      selectedBySessionRef.current.set(previous.key, previous.modelId);
      const [server, project, session] = previous.key.split('\n');
      if (loadedModelSelectionsRef.current.has(previous.key)) {
        void saveSessionModelSelection(server, project, session, previous.modelId).catch(() => undefined);
      }
    }
    previousModelSessionRef.current = sessionKey ? { key: sessionKey, modelId: chatPreferences.modelId } : undefined;
  }, [sessionKey, chatPreferences.modelId]);

  useEffect(() => {
    if (!sessionKey || !currentSessionId || !activeProjectPath || loadedModelSelectionsRef.current.has(sessionKey)) return;
    let active = true;
    void readSessionModelSelection(connectionScope, activeProjectPath, currentSessionId).then((saved) => {
      loadedModelSelectionsRef.current.add(sessionKey);
      if (saved && !explicitModelSelectionsRef.current.has(sessionKey)) {
        selectedBySessionRef.current.set(sessionKey, saved);
        if (active) {
          restoredSessionRef.current = undefined;
          setModelSelectionRevision((current) => current + 1);
        }
      } else if (!saved && selectedBySessionRef.current.has(sessionKey)) {
        void saveSessionModelSelection(connectionScope, activeProjectPath, currentSessionId, selectedBySessionRef.current.get(sessionKey)!).catch(() => undefined);
      }
    }).catch(() => { loadedModelSelectionsRef.current.add(sessionKey); });
    return () => { active = false; };
  }, [sessionKey, currentSessionId, activeProjectPath, connectionScope]);

  useEffect(() => {
    const previous = previousAgentSessionRef.current;
    if (previous && previous.key === sessionKey) {
      previous.mode = chatPreferences.mode;
      return;
    }
    if (previous) agentBySessionRef.current.set(previous.key, previous.mode);
    if (!sessionKey || !currentSessionId) {
      previousAgentSessionRef.current = undefined;
      return;
    }
    const session = sessions.find((item) => item.id === currentSessionId);
    if (!session || !availableAgents.length) return;
    const serverAgent = (session as Session & { agent?: string }).agent;
    const preferred = agentBySessionRef.current.get(sessionKey) ?? serverAgent;
    const mode = preferred && availableAgents.some((agent) => agent.id === preferred)
      ? preferred : getInitialMode(availableAgents, undefined, chatPreferences.mode);
    previousAgentSessionRef.current = { key: sessionKey, mode };
    agentBySessionRef.current.set(sessionKey, mode);
    if (mode !== chatPreferences.mode) setChatPreferences((current) => ({ ...current, mode }));
  }, [sessionKey, currentSessionId, sessions, availableAgents, chatPreferences.mode, setChatPreferences]);

  useEffect(() => {
    if (!sessionKey || !currentSessionId) {
      restoredSessionRef.current = undefined;
      return;
    }
    if (restoredSessionRef.current === sessionKey) return;
    const session = sessions.find((item) => item.id === currentSessionId);
    // Wait for a real session and catalog before restoring. New sessions have
    // no server model yet and inherit the last selected model.
    if ((!session && !selectedBySessionRef.current.has(sessionKey)) || !availableModels.length) return;
    const selectedId = getSessionSelection(selectedBySessionRef.current, sessionKey, session, availableModels, chatPreferences.modelId);
    if (selectedId && !availableModels.some((item) => item.id === selectedId)) return;
    restoredSessionRef.current = sessionKey;
    if (selectedId) {
      setChatPreferences((current) => restoreSessionModelPreference(current, { model: selectedId }, availableModels));
    }
  }, [sessionKey, currentSessionId, sessions, availableModels, chatPreferences.modelId, modelSelectionRevision, setChatPreferences]);
  const refreshChatCapabilities = useCallback(async () => {
    const result = await import('@/providers/services/capabilities-service').then((m) => m.discoverChatCapabilities(client, activeProjectPath));
    if (!isCurrentClient(client)) {
      return;
    }

    setCurrentConfig(result.config);
    setAvailableProviders(result.providers);
    setProviderAuthMethodsById(result.providerAuthMethodsById);
    setAvailableModels(result.models);
    setAvailableAgents(result.agents);

    setChatPreferences((current) => {
      const configuredProviderIds = getConfiguredProviderIds(result.config, result.connected, result.models);
      const configuredModels = result.models.filter((model) => configuredProviderIds.has(model.providerID));
      const enabledModelIds = getEnabledModelIds(configuredModels, current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = getInitialProviderId(configuredModels, result.config, current.providerId, current.modelId);
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, result.config, current.providerId, current.modelId);

      return {
        ...current,
        mode: getInitialMode(result.agents, result.config, current.mode),
        providerId: safeProviderId,
        modelId: getModelIdForProvider(
          enabledModels,
          safeProviderId,
          getInitialModelId(enabledModels, result.config, current.modelId),
          safeProviderId ? current.providerModelSelections[safeProviderId] : undefined,
        ),
        enabledModelIds,
        autoApprove: isAutoApproveEnabled(result.config),
      };
    });
  }, [activeProjectPath, client, isCurrentClient]);

  const configureProvider = useCallback(
    async (providerId: string) => {
      const latestConfig = currentConfig || (await client.config.get()).data;
      if (!latestConfig) {
        throw new Error('OpenCode did not return its configuration.');
      }
      const enabledProviders = new Set(latestConfig.enabled_providers || []);
      enabledProviders.add(providerId);

      const updatedConfig = (await client.config.update({
        config: {
          ...latestConfig,
          disabled_providers: (latestConfig.disabled_providers || []).filter((id) => id !== providerId),
          enabled_providers: [...enabledProviders].sort(),
        },
      })).data;
      if (!updatedConfig) {
        throw new Error('OpenCode did not return its updated configuration.');
      }

      setCurrentConfig(updatedConfig);
      await refreshChatCapabilities();
      setChatPreferences((current) => ({
        ...current,
        providerId: current.providerId || providerId,
      }));
    },
    [client, currentConfig, refreshChatCapabilities, setChatPreferences, setCurrentConfig],
  );

  const setProviderAuth = useCallback(
    async (providerId: string, values: ProviderAuthValues) => {
      const key = typeof values.key === 'string' ? values.key.trim() : '';
      const token = typeof values.token === 'string' ? values.token.trim() : '';
      if (!key) {
        throw new Error('Enter a provider credential first.');
      }

      const metadata = Object.fromEntries(
        Object.entries(values)
          .filter(([name, value]) => name !== 'key' && name !== 'token' && typeof value === 'string' && value.trim())
          .map(([name, value]) => [name, (value as string).trim()]),
      );
      const auth = token
        ? { type: 'wellknown' as const, key, token }
        : { type: 'api' as const, key, ...(Object.keys(metadata).length > 0 ? { metadata } : {}) };

      await client.auth.set({ providerID: providerId, auth });
      await configureProvider(providerId);
      await refreshChatCapabilities();
    },
    [client, configureProvider, refreshChatCapabilities],
  );

  const removeProvider = useCallback(async (providerId: string) => {
    await client.auth.remove({ providerID: providerId });
    const latestConfig = currentConfig || (await client.config.get()).data;
    if (latestConfig) {
      const updatedConfig = (await client.config.update({
        config: {
          ...latestConfig,
          disabled_providers: [...new Set([...(latestConfig.disabled_providers || []), providerId])].sort(),
          enabled_providers: (latestConfig.enabled_providers || []).filter((id) => id !== providerId),
        },
      })).data;
      setCurrentConfig(updatedConfig);
    }
    await refreshChatCapabilities();
  }, [client, currentConfig, refreshChatCapabilities, setCurrentConfig]);

  const startProviderOAuth = useCallback(
    async (providerId: string, methodIndex: number, inputs?: ProviderAuthValues) => {
      const authorization = (await client.provider.oauth.authorize({
        providerID: providerId,
        method: methodIndex,
        inputs: inputs as Record<string, string> | undefined,
      })).data;
      if (!authorization) {
        throw new Error('OpenCode did not return OAuth authorization details.');
      }

      return {
        url: authorization.url,
        instructions: authorization.instructions,
        method: authorization.method,
      };
    },
    [client],
  );

  const completeAutomaticProviderOAuth = useCallback(async (providerId: string) => {
    // On V2 the server owns the automatic OAuth callback, so wait on the attempt
    // status it records. V1 only exposes the connected provider list.
    if (client.providerOAuth) {
      await client.providerOAuth.wait(providerId);
      if (!isCurrentClient(client)) throw new Error('The connection changed before sign-in completed.');
      await configureProvider(providerId);
      return;
    }
    const deadline = Date.now() + 900_000;
    for (;;) {
      const providers = (await client.provider.list()).data;
      if (providers?.connected.includes(providerId)) {
        await configureProvider(providerId);
        return;
      }
      if (!isCurrentClient(client) || Date.now() >= deadline) {
        throw new Error('Provider sign-in was not completed. Finish authentication in the browser and try again.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }, [client, configureProvider, isCurrentClient]);

  const cancelProviderOAuth = useCallback(async (providerId: string) => {
    if (!client.providerOAuth) return;
    await client.providerOAuth.cancel(providerId);
  }, [client]);

  const completeProviderOAuth = useCallback(async (providerId: string, methodIndex: number, code: string) => {
    await client.provider.oauth.callback({
      providerID: providerId,
      method: methodIndex,
      code: code.trim() || undefined,
    });
    await configureProvider(providerId);
    await refreshChatCapabilities();
  }, [client, configureProvider, refreshChatCapabilities]);

  const addProviderAccount = useCallback(async (providerId: string, values: ProviderAuthValues, label?: string) => {
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.add(providerId, values, label);
    await configureProvider(providerId);
  }, [client, configureProvider]);

  const activateProviderAccount = useCallback(async (credentialId: string) => {
    await import('@/providers/services/capabilities-service').then((service) => service.activateVerifiedAccount(client, credentialId));
    await refreshChatCapabilities();
  }, [client, refreshChatCapabilities]);

  const bindSessionAccount = useCallback(async (credentialId: string) => {
    if (!activeProjectPath || !currentSessionId || !client.accounts) throw new Error('Select a chat on an OpenCode 2 server first.');
    const accounts = await client.accounts.list();
    if (!accounts.some((account) => account.id === credentialId)) throw new Error('Selected account is unavailable.');
    const response = await client.session.update({ sessionID: currentSessionId, credentialID: credentialId } as Parameters<typeof client.session.update>[0]);
    const confirmed = response.data as Session & { credentialID?: string };
    if (confirmed.credentialID !== credentialId) throw new Error('OpenCode did not confirm the selected session account.');
    if (!isCurrentClient(client)) return;
    setSessions((current) => current.map((item) => item.id === currentSessionId ? confirmed : item));
    await refreshChatCapabilities();
  }, [activeProjectPath, client, currentSessionId, isCurrentClient, refreshChatCapabilities, setSessions]);

  const refreshProviderAccounts = useCallback(async () => {
    if (!client.accounts) return;
    await client.accounts.list();
    await refreshChatCapabilities();
  }, [client, refreshChatCapabilities]);

  const renameProviderAccount = useCallback(async (credentialId: string, label: string) => {
    await import('@/providers/services/capabilities-service').then((service) => service.renameVerifiedAccount(client, credentialId, label));
    await refreshChatCapabilities();
  }, [client, refreshChatCapabilities]);

  const removeProviderAccount = useCallback(async (credentialId: string) => {
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.remove(credentialId);
    await refreshChatCapabilities();
  }, [client, refreshChatCapabilities]);

  const updateChatPreferences = useCallback((patch: Partial<ChatPreferences>) => {
    if (patch.modelId && sessionKey && activeProjectPath && currentSessionId) {
      selectedBySessionRef.current.set(sessionKey, patch.modelId);
      explicitModelSelectionsRef.current.add(sessionKey);
      void saveSessionModelSelection(connectionScope, activeProjectPath, currentSessionId, patch.modelId).catch(() => undefined);
    }
    if (patch.mode && sessionKey) agentBySessionRef.current.set(sessionKey, patch.mode);
    setChatPreferences((current) => {
      const configuredProviderIds = new Set(availableProviders.filter((provider) => provider.configured).map((provider) => provider.id));
      const configuredModels = availableModels.filter((model) => configuredProviderIds.has(model.providerID));
      const enabledModelIds = getEnabledModelIds(configuredModels, patch.enabledModelIds ?? current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = patch.providerId ?? current.providerId;
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, undefined, current.providerId, patch.modelId ?? current.modelId);
      const requestedModelId = patch.modelId ?? current.modelId;
      const nextProviderModelSelections = patch.modelId
        ? {
            ...current.providerModelSelections,
            [patch.providerId ?? safeProviderId ?? patch.modelId.split('/')[0]]: patch.modelId,
          }
        : current.providerModelSelections;
      const nextModelId = getModelIdForProvider(
        enabledModels,
        safeProviderId,
        requestedModelId,
        safeProviderId ? nextProviderModelSelections[safeProviderId] : undefined,
      );

      return {
        ...current,
        ...patch,
        providerId: safeProviderId,
        modelId: nextModelId,
        enabledModelIds,
        recentModelIds: recordRecentModelId(current.recentModelIds, patch.modelId),
        providerModelSelections:
          safeProviderId && nextModelId
            ? {
                ...nextProviderModelSelections,
                [safeProviderId]: nextModelId,
              }
            : nextProviderModelSelections,
      };
    });
  }, [activeProjectPath, availableModels, availableProviders, connectionScope, currentSessionId, sessionKey, setChatPreferences]);

  const setAutoApprove = useCallback(
    async (enabled: boolean) => {
      const latestConfig = currentConfig || (await client.config.get()).data;
      const nextConfig = mergePermissionConfig(latestConfig, enabled);
      const updatedConfig = (await client.config.update({ config: nextConfig })).data;
      if (!updatedConfig) {
        throw new Error('OpenCode did not return its updated configuration.');
      }

      setCurrentConfig(updatedConfig);
      setChatPreferences((current) => ({
        ...current,
        autoApprove: enabled,
      }));
    },
    [client, currentConfig, setChatPreferences, setCurrentConfig],
  );

  return {
    refreshChatCapabilities,
    configureProvider,
    setProviderAuth,
    removeProvider,
    startProviderOAuth,
    completeAutomaticProviderOAuth,
    completeProviderOAuth,
    cancelProviderOAuth,
    addProviderAccount,
    activateProviderAccount,
    bindSessionAccount,
    refreshProviderAccounts,
    renameProviderAccount,
    removeProviderAccount,
    updateChatPreferences,
    setAutoApprove,
  };
}
