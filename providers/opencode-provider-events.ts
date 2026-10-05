import type { GlobalEvent } from '@opencode-ai/sdk/v2/client';
import type { Dispatch, SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';
import type { FileDiff, SessionStatus, Todo } from '@/lib/opencode/types';

export type SessionRefreshOptions = {
  messages?: boolean;
  fullMessages?: boolean;
  diff?: boolean;
  todos?: boolean;
  sessions?: boolean;
  delayMs?: number;
};

export type ProviderEventActions = {
  refreshSessions: (silent?: boolean) => Promise<unknown>;
  refreshArchivedSessions: () => Promise<unknown>;
  scheduleSessionRefresh: (sessionId: string, options?: SessionRefreshOptions) => void;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshServerFeatures: () => Promise<unknown>;
  refreshChatCapabilities: () => Promise<unknown>;
  refreshWorkspaceCatalog: (silent?: boolean) => Promise<unknown>;
  refreshTerminals: () => Promise<unknown>;
  refreshWorktrees: () => Promise<unknown>;
  refreshMcpServers: () => Promise<unknown>;
  refreshDiagnostics: () => Promise<unknown>;
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  setPromptError: Dispatch<SetStateAction<{ message: string; occurredAt: number; sessionId?: string } | undefined>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;
  selectedDiffMessageBySessionRef: { current: Record<string, string | undefined> };
};

export function handleProviderEvent(event: GlobalEvent['payload'], actions: ProviderEventActions): void {
  switch (event.type) {
    case 'session.created':
    case 'session.updated':
    case 'session.deleted':
      void actions.refreshSessions(true).catch(() => undefined);
      void actions.refreshArchivedSessions().catch(() => undefined);
      return;
    case 'session.status': {
      const sessionId = event.properties.sessionID;
      actions.setSessionStatuses((current) => ({
        ...current,
        [sessionId]: event.properties.status,
      }));
      actions.scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true });
      return;
    }
    case 'session.idle': {
      const sessionId = event.properties.sessionID;
      actions.setSessionStatuses((current) => ({
        ...current,
        [sessionId]: { type: 'idle' },
      }));
      actions.scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 50 });
      void actions.refreshPendingInteractions().catch(() => undefined);
      void actions.refreshServerFeatures().catch(() => undefined);
      return;
    }
    case 'session.error': {
      const sessionId = event.properties.sessionID;
      const error = event.properties.error;
      const message = error && 'data' in error && error.data && 'message' in error.data
        ? error.data.message
        : error && 'message' in error
          ? error.message
          : 'OpenCode could not complete the request.';
      actions.setPromptError({
        message: error?.name ? `${error.name}: ${message}` : String(message),
        occurredAt: Date.now(),
        sessionId,
      });
      if (sessionId) {
        actions.scheduleSessionRefresh(sessionId, { sessions: true, messages: true });
      }
      return;
    }
    case 'message.updated': {
      actions.scheduleSessionRefresh(event.properties.sessionID, { messages: true });
      return;
    }
    case 'message.removed': {
      // Removal is destructive: rebuild the transcript rather than tail-merge.
      actions.scheduleSessionRefresh(event.properties.sessionID, { messages: true, fullMessages: true });
      return;
    }
    case 'message.part.updated':
    case 'message.part.removed': {
      actions.scheduleSessionRefresh(event.properties.sessionID, { messages: true });
      return;
    }
    case 'session.compacted': {
      actions.scheduleSessionRefresh(event.properties.sessionID, { sessions: true, messages: true, fullMessages: true, diff: true, todos: true });
      return;
    }
    case 'catalog.updated':
      void actions.refreshChatCapabilities().catch(() => undefined);
      return;
    case 'project.updated':
      void actions.refreshWorkspaceCatalog(true).catch(() => undefined);
      return;
    case 'file.edited':
    case 'vcs.branch.updated':
      void actions.refreshServerFeatures().catch(() => undefined);
      return;
    case 'pty.created':
    case 'pty.updated':
    case 'pty.exited':
    case 'pty.deleted':
      void actions.refreshTerminals().catch(() => undefined);
      return;
    case 'worktree.ready':
    case 'worktree.failed':
      void actions.refreshWorktrees().catch(() => undefined);
      void actions.refreshWorkspaceCatalog(true).catch(() => undefined);
      return;
    case 'mcp.tools.changed':
    case 'mcp.browser.open.failed':
      void actions.refreshMcpServers().catch(() => undefined);
      return;
    case 'lsp.updated':
      void actions.refreshDiagnostics().catch(() => undefined);
      return;
    case 'session.diff': {
      const sessionId = event.properties.sessionID;
      // When the surface is pinned to an earlier turn, an incoming latest-turn
      // diff must not overwrite it; refresh the selected turn instead.
      if (event.properties.diff?.length > 0 && !actions.selectedDiffMessageBySessionRef.current[sessionId]) {
        actions.setDiffsBySession((current) => ({
          ...current,
          [sessionId]: event.properties.diff,
        }));
      } else {
        actions.scheduleSessionRefresh(sessionId, { diff: true, delayMs: 50 });
      }
      return;
    }
    case 'todo.updated': {
      const sessionId = event.properties.sessionID;
      actions.setTodosBySession((current) => ({
        ...current,
        [sessionId]: event.properties.todos,
      }));
      return;
    }
    case 'permission.asked': {
      const request = event.properties;
      actions.setPendingPermissionsBySession((current) => ({
        ...current,
        [request.sessionID]: [
          ...(current[request.sessionID] || []).filter((item) => item.id !== request.id),
          request,
        ],
      }));
      return;
    }
    case 'permission.replied': {
      const { sessionID, requestID } = event.properties;
      actions.setPendingPermissionsBySession((current) => ({
        ...current,
        [sessionID]: (current[sessionID] || []).filter((item) => item.id !== requestID),
      }));
      return;
    }
    case 'question.asked': {
      const request = event.properties;
      actions.setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: [
          ...(current[request.sessionID] || []).filter((item) => item.id !== request.id),
          request,
        ],
      }));
      return;
    }
    case 'question.replied':
    case 'question.rejected': {
      const { sessionID, requestID } = event.properties;
      actions.setPendingQuestionsBySession((current) => ({
        ...current,
        [sessionID]: (current[sessionID] || []).filter((item) => item.id !== requestID),
      }));
      return;
    }
    default:
      return;
  }
}
