import type { TFunction } from 'i18next';

import { SUPPORTED_LANGUAGES } from '@/lib/i18n/languages';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';
import type { ResponseScope } from '@/providers/opencode-provider';

export const RESPONSE_SCOPE_OPTIONS: { value: ResponseScope }[] = [
  { value: 'brief' },
  { value: 'balanced' },
  { value: 'detailed' },
];

export const WORKING_SOUND_OPTIONS: { value: WorkingSoundVariant }[] = [
  { value: 'soft' },
  { value: 'glass' },
];

export const LANGUAGE_OPTIONS: { value: string; label: string }[] = SUPPORTED_LANGUAGES.map((language) => ({ value: language.code, label: language.nativeName }));

// Curated copy is independent of credential support. V1 providers offer
// API-key entry alongside auth metadata, except known OAuth-only providers.
const PROVIDER_DESCRIPTORS = new Map<string, { genericApiKey: boolean }>([
  ['anthropic', { genericApiKey: true }],
  ['azure', { genericApiKey: true }],
  ['github-copilot', { genericApiKey: false }],
  ['google', { genericApiKey: true }],
  ['groq', { genericApiKey: true }],
  ['mistral', { genericApiKey: true }],
  ['openai', { genericApiKey: true }],
  ['openrouter', { genericApiKey: true }],
  ['xai', { genericApiKey: true }],
]);

export function supportsGenericApiKey(providerId?: string) {
  return Boolean(providerId && (PROVIDER_DESCRIPTORS.get(providerId)?.genericApiKey ?? true));
}

export function getProviderCopy(providerId: string, fallbackLabel: string, t: TFunction) {
  if (!PROVIDER_DESCRIPTORS.has(providerId)) {
    return {
      label: fallbackLabel,
      description: undefined,
    };
  }

  return {
    label: t(`settings:providerCopy.${providerId}.label`),
    description: t(`settings:providerCopy.${providerId}.description`),
  };
}
