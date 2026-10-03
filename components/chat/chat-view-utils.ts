import type { ReasoningLevel } from '@/providers/opencode-provider';

export const STARTER_PROMPT_KEYS = [
  'chat:starter.prompts.polish',
  'chat:starter.prompts.review',
  'chat:starter.prompts.implement',
];

export const REASONING_OPTIONS: { id: ReasoningLevel; labelKey: string }[] = [
  { id: 'low', labelKey: 'chat:reasoning.low' },
  { id: 'default', labelKey: 'chat:reasoning.default' },
  { id: 'high', labelKey: 'chat:reasoning.high' },
];

export function getAutoApproveIcon(autoApprove: boolean) {
  return autoApprove ? 'alert-outline' : 'shield-outline';
}
