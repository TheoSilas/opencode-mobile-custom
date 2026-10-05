import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { Config } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { isAutoApproveEnabled, mergePermissionConfig } from '@/providers/opencode-capabilities';
import {
  getConfiguredProviderIds,
  getEnabledModelIds,
  getInitialMode,
  getInitialModelId,
  getInitialProviderId,
  getModelIdForProvider,
  recordRecentModelId,
} from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ProviderAuthMethod, ProviderOption } from '@/providers/opencode-provider-types';

type CapabilitiesActionsInput = {
  client: ScopedOpencodeClient;
  activeProjectPath?: string;
  isCurrentClient: (candidate: object) => boolean;
  currentConfig?: Config;
  availableProviders: ProviderOption[];
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
  isCurrentClient,
  currentConfig,
  availableProviders,
  availableModels,
  setCurrentConfig,
  setAvailableProviders,
  setProviderAuthMethodsById,
  setAvailableModels,
  setAvailableAgents,
  setChatPreferences,
}: CapabilitiesActionsInput) {
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
    async (providerId: string, values: Record<string, string>) => {
      const key = values.key?.trim();
      const token = values.token?.trim();
      if (!key) {
        throw new Error('Enter a provider credential first.');
      }

      const metadata = Object.fromEntries(
        Object.entries(values)
          .filter(([name, value]) => name !== 'key' && name !== 'token' && value.trim())
          .map(([name, value]) => [name, value.trim()]),
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
    async (providerId: string, methodIndex: number, inputs?: Record<string, string>) => {
      const authorization = (await client.provider.oauth.authorize({
        providerID: providerId,
        method: methodIndex,
        inputs,
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
    // Automatic OAuth completes on the server after the browser redirects to
    // the server's callback, which can lag the browser closing by a few seconds.
    // Poll until the provider reports connected, bounded so a cancelled sign-in
    // still surfaces an actionable error.
    const deadline = Date.now() + 90_000;
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

  const completeProviderOAuth = useCallback(async (providerId: string, methodIndex: number, code: string) => {
    await client.provider.oauth.callback({
      providerID: providerId,
      method: methodIndex,
      code: code.trim() || undefined,
    });
    await configureProvider(providerId);
    await refreshChatCapabilities();
  }, [client, configureProvider, refreshChatCapabilities]);

  const addProviderAccount = useCallback(async (providerId: string, values: Record<string, string>, label?: string) => {
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.add(providerId, values, label);
    await configureProvider(providerId);
  }, [client, configureProvider]);

  const activateProviderAccount = useCallback(async (credentialId: string) => {
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.activate(credentialId);
    await refreshChatCapabilities();
  }, [client, refreshChatCapabilities]);

  const removeProviderAccount = useCallback(async (credentialId: string) => {
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.remove(credentialId);
    await refreshChatCapabilities();
  }, [client, refreshChatCapabilities]);

  const updateChatPreferences = useCallback((patch: Partial<ChatPreferences>) => {
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
  }, [availableModels, availableProviders, setChatPreferences]);

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
    addProviderAccount,
    activateProviderAccount,
    removeProviderAccount,
    updateChatPreferences,
    setAutoApprove,
  };
}
