import {
  type OpencodeClient,
  type PermissionRequest,
  type QuestionAnswer,
} from '@opencode-ai/sdk/v2/client';
import Constants from 'expo-constants';

import type { ConnectMetadata } from '@/lib/connect';

export type ServerContract = 'v1' | 'v2';

export type PendingPermissionRequest = PermissionRequest;

type PendingQuestionOption = {
  label: string;
  description?: string;
  /** Stable value submitted to the server. V1 uses the label; V2 forms carry an explicit value. */
  value?: string;
};

type PendingQuestionWhen = {
  key: string;
  op: 'eq' | 'neq';
  value: string | number | boolean;
};

export type PendingQuestionPrompt = {
  header: string;
  question: string;
  options: PendingQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
  /** V2 form field key, used to resolve `when` conditions. */
  key?: string;
  /** V2 form field type. V1 questions omit this and render as a single/multi choice. */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external';
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  url?: string;
  when?: PendingQuestionWhen[];
};

export type PendingQuestionRequest = {
  id: string;
  sessionID: string;
  title?: string;
  questions: PendingQuestionPrompt[];
};

export type PendingQuestionAnswer = QuestionAnswer;

export type OpencodeConnectionSettings = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
  connect?: ConnectMetadata;
};

export const defaultConnectionSettings: OpencodeConnectionSettings = {
  serverUrl: String(process.env.EXPO_PUBLIC_E2E_SERVER_URL || Constants.expoConfig?.extra?.e2eServerUrl || 'http://127.0.0.1:4096'),
  username: '',
  password: '',
  directory: '',
};

export type NormalizedServerUrl = {
  displayUrl: string;
  origin: string;
  pathPrefix: string;
  valid: boolean;
};

export type ClientMetadata = {
  directory?: string;
};

export type ScopedOpencodeClient = OpencodeClient & {
  __opencode: ClientMetadata;
};
