import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

export type PromptAttachment = { uri: string; mime?: string; filename?: string };
export type PromptDelivery = 'steer' | 'queue';
export type PromptInput = Parameters<OpencodeClient['session']['promptAsync']>[0];
export type PendingPrompt = {
  id: string;
  sessionId: string;
  createdAt: number;
  text: string;
  attachments: PromptAttachment[];
  delivery: PromptDelivery;
  state: 'sending' | 'waiting';
};

export type PromptInboxApi = {
  submit: (input: PromptInput, delivery: PromptDelivery) => Promise<PendingPrompt>;
  list: (sessionId: string) => Promise<PendingPrompt[]>;
};
