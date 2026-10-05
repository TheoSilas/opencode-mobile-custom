import type { ProviderListResponse } from '@opencode-ai/sdk/v2/client';

import { compareLabels } from '@/lib/compare-labels';
import type { ProviderAccountInfo, ScopedOpencodeClient } from '@/lib/opencode/client';
import { getConfiguredProviderIds, toAgentOption, type ModelOption } from '@/providers/opencode-model-selection';
import { requireData } from '@/providers/services/require-data';

type DiscoveredModel = ProviderListResponse['all'][number]['models'][string];
const INPUT_MODALITIES: ModelOption['inputModalities'] = ['text', 'audio', 'image', 'video', 'pdf'];

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

export async function discoverChatCapabilities(client: ScopedOpencodeClient, activeProjectPath?: string) {
  if (!activeProjectPath) {
    return {
      config: undefined,
      providers: [],
      providerAuthMethodsById: {},
      models: [],
      agents: [],
      connected: [],
      configuredModels: [],
    };
  }

  const [configResponse, providersResponse, providerAuthResponse, agentsResponse, accounts] = await Promise.all([
    client.config.get(),
    client.provider.list(),
    client.provider.auth(),
    client.app.agents(),
    client.accounts ? client.accounts.list().catch(() => [] as ProviderAccountInfo[]) : Promise.resolve([] as ProviderAccountInfo[]),
  ]);

  const nextConfig = requireData(configResponse.data, 'config request');
  const providerData = requireData(providersResponse.data, 'provider request');
  const authData = requireData(providerAuthResponse.data, 'provider auth request');
  const agentData = requireData(agentsResponse.data, 'agent request');
  const nextModels = uniqueById(providerData.all
    .flatMap((provider) =>
      Object.values(provider.models).map((model: DiscoveredModel): ModelOption => ({
        id: `${provider.id}/${model.id}`,
        label: model.name,
        providerID: provider.id,
        providerLabel: provider.name,
        modelID: model.id,
        supportsReasoning: model.capabilities.reasoning,
        supportsAttachments: model.capabilities.attachment,
        inputModalities: INPUT_MODALITIES.filter((modality) => model.capabilities.input[modality]),
        supportsToolCalls: model.capabilities.toolcall,
        contextLimit: model.limit.context,
        outputLimit: model.limit.output,
        pricing: model.cost,
        status: model.status,
      })),
    )
    .sort((left, right) => {
      const leftDefault = providerData.default[left.providerID] === left.modelID;
      const rightDefault = providerData.default[right.providerID] === right.modelID;
      return Number(rightDefault) - Number(leftDefault) || compareLabels(left.label, right.label);
    }));

  const configuredProviderIds = getConfiguredProviderIds(nextConfig, providerData.connected, nextModels);
  const configuredModels = nextModels.filter((model) => configuredProviderIds.has(model.providerID));
  const accountsByProvider = new Map<string, ProviderAccountInfo[]>();
  accounts.forEach((account) => {
    const list = accountsByProvider.get(account.providerId) ?? [];
    list.push(account);
    accountsByProvider.set(account.providerId, list);
  });
  const nextProviders = uniqueById(providerData.all
    .map((provider) => {
      const providerAccounts = accountsByProvider.get(provider.id);
      return {
        id: provider.id,
        label: provider.name,
        modelCount: Object.keys(provider.models).length,
        configured: configuredProviderIds.has(provider.id) || Boolean(providerAccounts?.length),
        ...(providerAccounts?.length
          ? { accounts: providerAccounts.map(({ id, label, method, active }) => ({ id, label, method, active })) }
          : {}),
      };
    })
    .sort((left, right) => compareLabels(left.label, right.label)));
  const nextAgents = uniqueById(agentData.map(toAgentOption));

  return {
    config: nextConfig,
    providers: nextProviders,
    connected: providerData.connected,
    providerAuthMethodsById: authData,
    models: nextModels,
    agents: nextAgents,
    configuredModels,
  };
}
