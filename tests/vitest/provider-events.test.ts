import { describe, expect, it, vi } from 'vitest';

import { mapV2Event } from '@/lib/opencode/v2/events';
import type { AdapterContext } from '@/lib/opencode/v2/shared';
import { handleProviderEvent, type ProviderEventActions } from '@/providers/opencode-provider-events';

vi.mock('@opencode/client', () => ({ OpenCode: { make: () => ({}) } }));
vi.mock('@/lib/opencode/client', () => ({
  getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }),
  getRequestHeaders: () => ({}),
  createPrefixFetch: () => () => {},
}));

const ctx = { permissionSession: new Map(), formSession: new Map() } as unknown as AdapterContext;

const mapped = (type: string, data: Record<string, unknown> = {}) =>
  mapV2Event({ id: 'event-1', type, data }, ctx);

describe('mapV2Event refresh mappings', () => {
  it('maps diagnostics, MCP, worktree, credential, command and session detail events', () => {
    expect(mapped('lsp.updated')?.payload.type).toBe('lsp.updated');
    expect(mapped('mcp.tools.changed')?.payload.type).toBe('mcp.tools.changed');
    expect(mapped('worktree.failed')?.payload.type).toBe('worktree.failed');
    expect(mapped('credential.switched')?.payload.type).toBe('catalog.updated');
    expect(mapped('session.instructions.updated', { sessionID: 's1' })?.payload.type).toBe('session.updated');
    expect(mapped('session.metadata.updated', { sessionID: 's1' })?.payload.type).toBe('session.updated');
    expect(mapped('command.executed', { sessionID: 's1' })?.payload.type).toBe('session.updated');
  });
});

function createActions() {
  const calls = {
    refreshSessions: vi.fn(async () => undefined),
    refreshMcpServers: vi.fn(async () => undefined),
    refreshWorkspaceCatalog: vi.fn(async () => undefined),
    refreshChatCapabilities: vi.fn(async () => undefined),
    refreshServerFeatures: vi.fn(async () => undefined),
    scheduleSessionRefresh: vi.fn(),
    setMcpAuthPrompt: vi.fn(),
  };
  const actions = {
    refreshSessions: calls.refreshSessions,
    refreshArchivedSessions: async () => undefined,
    scheduleSessionRefresh: calls.scheduleSessionRefresh,
    refreshPendingInteractions: async () => undefined,
    refreshServerFeatures: calls.refreshServerFeatures,
    refreshChatCapabilities: calls.refreshChatCapabilities,
    refreshWorkspaceCatalog: calls.refreshWorkspaceCatalog,
    refreshTerminals: async () => undefined,
    refreshWorktrees: async () => undefined,
    refreshMcpServers: calls.refreshMcpServers,
    refreshDiagnostics: async () => undefined,
    setSessionStatuses: vi.fn(),
    setPromptError: vi.fn(),
    setDiffsBySession: vi.fn(),
    setTodosBySession: vi.fn(),
    setPendingPermissionsBySession: vi.fn(),
    setPendingQuestionsBySession: vi.fn(),
    setMcpAuthPrompt: calls.setMcpAuthPrompt,
    selectedDiffMessageBySessionRef: { current: {} },
  } as unknown as ProviderEventActions;
  return { actions, calls };
}

describe('handleProviderEvent', () => {
  it('surfaces an MCP browser open failure and refreshes MCP servers', () => {
    const { actions, calls } = createActions();
    handleProviderEvent(
      { id: 'e', type: 'mcp.browser.open.failed', properties: { mcpName: 'remote', url: 'https://example.com/auth' } } as never,
      actions,
    );
    expect(calls.setMcpAuthPrompt).toHaveBeenCalledWith({ mcpName: 'remote', url: 'https://example.com/auth' });
    expect(calls.refreshMcpServers).toHaveBeenCalled();
  });

  it('refreshes the transcript tail on a part delta', () => {
    const { actions, calls } = createActions();
    handleProviderEvent({ id: 'e', type: 'message.part.delta', properties: { sessionID: 's1' } } as never, actions);
    expect(calls.scheduleSessionRefresh).toHaveBeenCalledWith('s1', { messages: true });
  });

  it('refreshes the workspace catalog when project directories change', () => {
    const { actions, calls } = createActions();
    handleProviderEvent({ id: 'e', type: 'project.directories.updated', properties: { projectID: 'p1' } } as never, actions);
    expect(calls.refreshWorkspaceCatalog).toHaveBeenCalledWith(true);
  });

  it('refreshes sessions when a subagent asks for permission', () => {
    const { actions, calls } = createActions();
    handleProviderEvent(
      { id: 'e', type: 'permission.asked', properties: { id: 'perm-1', sessionID: 'child' } } as never,
      actions,
    );
    expect(calls.refreshSessions).toHaveBeenCalled();
  });
});
