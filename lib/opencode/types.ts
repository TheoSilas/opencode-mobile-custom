export type {
  Agent,
  Command,
  Config,
  File,
  FileContent,
  FileNode,
  FormatterStatus,
  LspStatus,
  McpLocalConfig,
  McpOAuthConfig,
  McpRemoteConfig,
  McpStatus,
  Message,
  Model,
  Part,
  PermissionRuleset,
  Project,
  Provider,
  Pty,
  PtyShellsResponse,
  PtyTicketConnectToken,
  Session,
  SessionStatus,
  Symbol,
  Todo,
  ToolIds,
  ToolList,
  ToolListItem,
  ToolPart,
  VcsApplyError,
  VcsFileDiff,
  VcsFileStatus,
  VcsInfo,
  Worktree,
  WorktreeCreateInput,
  WorktreeRemoveInput,
  WorktreeResetInput,
  AppSkillsResponse as Skills,
  GlobalSession,
  SnapshotFileDiff as FileDiff,
} from '@opencode-ai/sdk/v2/client';

// Provider credential input values. V2 forms can carry non-string values
// (numbers, switches, multi-selects) alongside text fields.
export type ProviderAuthValues = Record<string, string | number | boolean | string[]>;

export type ProviderAuthPromptWhen = {
  key: string;
  op: 'eq' | 'neq';
  value: string | number | boolean;
};

// Normalized provider auth prompt. Both the V1 auth metadata and the richer V2
// integration forms (string/select/number/boolean/multiselect/external) map
// into this so the setup UI renders type-specific controls from one model.
export type ProviderAuthPrompt = {
  type: 'text' | 'select' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external';
  key: string;
  message: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string | number | boolean | string[];
  required?: boolean;
  min?: number;
  max?: number;
  url?: string;
  when?: ProviderAuthPromptWhen[];
};

export type ProviderAuthMethod = {
  type: 'oauth' | 'api';
  label: string;
  prompts?: ProviderAuthPrompt[];
};

export default {};
