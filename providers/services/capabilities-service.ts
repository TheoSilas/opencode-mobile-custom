import type { ProviderListResponse } from '@opencode-ai/sdk/v2/client';

import { compareLabels } from '@/lib/compare-labels';
import type { ProviderAccountInfo, ScopedOpencodeClient } from '@/lib/opencode/client';
import type { ProviderAuthMethod, ProviderAuthPrompt } from '@/lib/opencode/types';
import { getConfiguredProviderIds, toAgentOption, type ModelOption } from '@/providers/opencode-model-selection';
import { requireData } from '@/providers/services/require-data';

const PROMPT_TYPES: ProviderAuthPrompt['type'][] = ['text', 'select', 'number', 'integer', 'boolean', 'multiselect', 'external'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// V1 auth metadata and the V2-normalized methods share one prompt model. V1
// carries a single `when` condition; V2 carries an array.
function normalizePrompt(prompt: unknown): ProviderAuthPrompt {
  const value = asRecord(prompt);
  const type = PROMPT_TYPES.includes(value.type as ProviderAuthPrompt['type'])
    ? (value.type as ProviderAuthPrompt['type'])
    : 'text';
  const rawWhen = Array.isArray(value.when) ? value.when : value.when ? [value.when] : undefined;
  return {
    type,
    key: typeof value.key === 'string' ? value.key : '',
    message: typeof value.message === 'string' ? value.message : typeof value.key === 'string' ? value.key : '',
    placeholder: typeof value.placeholder === 'string' ? value.placeholder : undefined,
    options: Array.isArray(value.options)
      ? value.options.map((option) => {
        const entry = asRecord(option);
        return { label: String(entry.label ?? entry.value ?? ''), value: String(entry.value ?? '') };
      })
      : undefined,
    defaultValue: value.defaultValue as ProviderAuthPrompt['defaultValue'],
    required: typeof value.required === 'boolean' ? value.required : undefined,
    min: typeof value.min === 'number' ? value.min : undefined,
    max: typeof value.max === 'number' ? value.max : undefined,
    url: typeof value.url === 'string' ? value.url : undefined,
    when: rawWhen?.map((condition) => {
      const entry = asRecord(condition);
      return {
        key: String(entry.key ?? ''),
        op: entry.op === 'neq' ? 'neq' as const : 'eq' as const,
        value: entry.value as string | number | boolean,
      };
    }),
  };
}

function normalizeProviderAuthMethods(authData: unknown): Record<string, ProviderAuthMethod[]> {
  return Object.fromEntries(
    Object.entries(asRecord(authData)).map(([providerId, methods]) => [
      providerId,
      Array.isArray(methods)
        ? methods.map((method): ProviderAuthMethod => {
          const value = asRecord(method);
          return {
            type: value.type === 'oauth' ? 'oauth' : 'api',
            label: typeof value.label === 'string' ? value.label : '',
            prompts: Array.isArray(value.prompts) ? value.prompts.map(normalizePrompt) : undefined,
          };
        })
        : [],
    ]),
  );
}

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
  const accountsByIntegration = new Map<string, ProviderAccountInfo[]>();
  accounts.forEach((account) => {
    const list = accountsByIntegration.get(account.providerId) ?? [];
    list.push(account);
    accountsByIntegration.set(account.providerId, list);
  });
  const nextProviders = uniqueById(providerData.all
    .map((provider) => {
      // The catalog entry carries the integrations that serve the provider's
      // login methods; fall back to the provider id for V1 and legacy shapes.
      const integrationIds = (provider as { integrationIds?: string[] }).integrationIds ?? [provider.id];
      const providerAccounts = [...new Set(integrationIds)].flatMap((id) => accountsByIntegration.get(id) ?? []);
      return {
        id: provider.id,
        label: provider.name,
        modelCount: Object.keys(provider.models).length,
        configured: configuredProviderIds.has(provider.id) || providerAccounts.length > 0,
        integrationIds,
        ...(providerAccounts.length
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
    providerAuthMethodsById: normalizeProviderAuthMethods(authData),
    models: nextModels,
    agents: nextAgents,
    configuredModels,
  };
}
