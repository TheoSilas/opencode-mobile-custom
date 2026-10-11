import { useCallback, useMemo, useRef, useState } from 'react';

import { listPendingInteractions } from '@/lib/opencode/client';
import { areSessionListsEqual, areSessionStatusMapsEqual, groupPendingRequestsBySession, mergeSessionStatuses } from '@/providers/opencode-provider-utils';
import type { DiffScope } from '@/providers/opencode-provider-types';
import type { SessionRefreshOptions } from '@/providers/opencode-provider-events';
import { persistSessionCache } from '@/providers/session-cache';
import {
  listSessions as svcListSessions,
  listOlderSessions as svcListOlderSessions,
  getSessionDiff as svcGetSessionDiff,
  getSessionTodos as svcGetSessionTodos,
} from '@/providers/services/session-service';
import { getVcsDiff as svcGetVcsDiff } from '@/providers/services/workspace-service';
import type { WorkspaceActionsInput } from '@/providers/opencode-provider-action-inputs';

export function useWorkspaceRefreshActions({
  activeProjectPath,
  client,
  isCurrentClient,
  setSessions,
  setSessionStatuses,
  setIsRefreshingSessions,
  setIsRefreshingDiffs,
  setDiffsBySession,
  setVcsDiffsByScope,
  setTodosBySession,
  setPendingPermissionsBySession,
  setPendingQuestionsBySession,
  setDiffScopeBySession,
  setSelectedDiffMessageBySession,
  selectedDiffMessageBySessionRef,
  diffScopeBySessionRef,
  currentSessionIdRef,
  messagesBySessionRef,
  sessionRefreshTimeoutsRef,
  sessionRefreshOptionsRef,
  connectionScope,
  refreshMessages,
}: WorkspaceActionsInput) {
  const pageRef = useRef<{ client: object; cursor?: string; loaded: boolean; busy: boolean } | undefined>(undefined);
  const [pageState, setPageState] = useState<{ client: object; cursor?: string; busy: boolean }>();
  const fetchSessions = useCallback(
    async (silent = false) => {
      if (!activeProjectPath) {
        setSessions([]);
        setSessionStatuses({});
        return [];
      }

      if (!silent) {
        setIsRefreshingSessions(true);
      }

      try {
        const result = await svcListSessions(client);
        if (!isCurrentClient(client)) {
          return result.sessions;
        }
        const paging = pageRef.current;
        setSessions((current) => {
          const first = new Set(result.sessions.map((item) => item.id));
          const merged = paging?.client === client && paging.loaded
            ? [...result.sessions, ...current.filter((item) => !first.has(item.id))].sort((left, right) => right.time.updated - left.time.updated)
            : result.sessions;
          return areSessionListsEqual(current, merged) ? current : merged;
        });
        if (!paging || paging.client !== client) {
          pageRef.current = { client, cursor: result.nextCursor, loaded: false, busy: false };
          setPageState({ client, cursor: result.nextCursor, busy: false });
        }
        setSessionStatuses((current) => {
          const next = mergeSessionStatuses(current, result.statuses);
          return areSessionStatusMapsEqual(current, next) ? current : next;
        });
        void persistSessionCache(connectionScope, activeProjectPath, result.sessions, result.statuses);
        return result.sessions;
      } finally {
        if (!silent) {
          setIsRefreshingSessions(false);
        }
      }
    },
    [activeProjectPath, client, connectionScope, isCurrentClient],
  );

  const refreshSessions = useCallback(
    async (silent = false) => {
      await fetchSessions(silent);
    },
    [fetchSessions],
  );

  const loadMoreSessions = useCallback(async () => {
    const page = pageRef.current;
    if (!page || page.client !== client || !page.cursor || page.busy) return;
    page.busy = true;
    setPageState({ client, cursor: page.cursor, busy: true });
    try {
      const older = await svcListOlderSessions(client, page.cursor);
      if (!isCurrentClient(client) || pageRef.current !== page) return;
      page.cursor = older.nextCursor;
      page.loaded = true;
      setSessions((current) => {
        const ids = new Set(current.map((item) => item.id));
        const next = [...current, ...older.sessions.filter((item) => !ids.has(item.id))]
          .sort((left, right) => right.time.updated - left.time.updated);
        return areSessionListsEqual(current, next) ? current : next;
      });
    } finally {
      page.busy = false;
      if (isCurrentClient(client) && pageRef.current === page) setPageState({ client, cursor: page.cursor, busy: false });
    }
  }, [client, isCurrentClient, setSessions]);
  const sessionPaging = useMemo(() => ({
    hasOlder: pageState?.client === client && Boolean(pageState.cursor),
    isLoadingOlder: pageState?.client === client && pageState.busy,
    loadMore: loadMoreSessions,
  }), [client, loadMoreSessions, pageState]);

  const refreshSessionDiff = useCallback(
    async (sessionId: string, silent = false, messageId?: string) => {
      if (!silent) {
        setIsRefreshingDiffs(true);
      }

      try {
        const targetMessageId = messageId ?? selectedDiffMessageBySessionRef.current[sessionId];
        const data = await svcGetSessionDiff(client, sessionId, targetMessageId, messagesBySessionRef.current[sessionId]);
        if (!isCurrentClient(client)) {
          return data;
        }
        setDiffsBySession((current) => ({
          ...current,
          [sessionId]: data,
        }));

        return data;
      } finally {
        if (!silent) {
          setIsRefreshingDiffs(false);
        }
      }
    },
    [client, isCurrentClient],
  );

  const refreshVcsDiff = useCallback(
    async (scope: 'uncommitted' | 'branch', silent = false) => {
      if (!silent) {
        setIsRefreshingDiffs(true);
      }

      try {
        const data = await svcGetVcsDiff(client, scope === 'branch' ? 'branch' : 'git');
        if (!isCurrentClient(client)) {
          return data;
        }
        setVcsDiffsByScope((current) => ({
          ...current,
          [scope]: data,
        }));

        return data;
      } finally {
        if (!silent) {
          setIsRefreshingDiffs(false);
        }
      }
    },
    [client, isCurrentClient],
  );

  const setDiffScope = useCallback(
    (scope: DiffScope) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      setDiffScopeBySession((current) => ({ ...current, [sessionId]: scope }));
      if (scope !== 'turn') {
        void refreshVcsDiff(scope, true);
      }
    },
    [refreshVcsDiff],
  );

  const selectDiffMessage = useCallback(
    (messageId: string) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      setSelectedDiffMessageBySession((current) => ({ ...current, [sessionId]: messageId }));
      void refreshSessionDiff(sessionId, true, messageId);
    },
    [refreshSessionDiff],
  );

  const refreshDiffs = useCallback(
    async (silent = false) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      const scope = diffScopeBySessionRef.current[sessionId] ?? 'turn';
      if (scope === 'turn') {
        await refreshSessionDiff(sessionId, silent);
      } else {
        await refreshVcsDiff(scope, silent);
      }
    },
    [refreshSessionDiff, refreshVcsDiff],
  );

  const refreshSessionTodos = useCallback(
    async (sessionId: string) => {
      const data = await svcGetSessionTodos(client, sessionId);
      if (!isCurrentClient(client)) {
        return data;
      }

      setTodosBySession((current) => ({
        ...current,
        [sessionId]: data,
      }));

      return data;
    },
    [client, isCurrentClient],
  );

  const refreshPendingInteractions = useCallback(async () => {
    const { permissions, questions } = await listPendingInteractions(client);
    if (!isCurrentClient(client)) {
      return;
    }
    setPendingPermissionsBySession(groupPendingRequestsBySession(permissions));
    setPendingQuestionsBySession(groupPendingRequestsBySession(questions));
  }, [client, isCurrentClient]);

  const scheduleSessionRefresh = useCallback(
    (sessionId: string, options?: SessionRefreshOptions) => {
      if (!sessionId) {
        return;
      }

      const existing = sessionRefreshTimeoutsRef.current[sessionId];
      if (existing) {
        clearTimeout(existing);
      }

      const pending = sessionRefreshOptionsRef.current[sessionId] || {};
      sessionRefreshOptionsRef.current[sessionId] = {
        messages: pending.messages || options?.messages,
        fullMessages: pending.fullMessages || options?.fullMessages,
        diff: pending.diff || options?.diff,
        todos: pending.todos || options?.todos,
        sessions: pending.sessions || options?.sessions,
      };

      sessionRefreshTimeoutsRef.current[sessionId] = setTimeout(() => {
        delete sessionRefreshTimeoutsRef.current[sessionId];
        const mergedOptions = sessionRefreshOptionsRef.current[sessionId] || {};
        delete sessionRefreshOptionsRef.current[sessionId];

        if (mergedOptions.sessions) {
          void refreshSessions(true).catch(() => undefined);
        }
        if (mergedOptions.messages) {
          void refreshMessages(sessionId, true, mergedOptions.fullMessages ? { full: true } : undefined).catch(() => undefined);
        }
        if (mergedOptions.diff) {
          void refreshSessionDiff(sessionId, true).catch(() => undefined);
        }
        if (mergedOptions.todos) {
          void refreshSessionTodos(sessionId).catch(() => undefined);
        }
      }, options?.delayMs ?? 150);
    },
    [refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  return {
    fetchSessions,
    refreshSessions,
    sessionPaging,
    refreshSessionDiff,
    refreshVcsDiff,
    setDiffScope,
    selectDiffMessage,
    refreshDiffs,
    refreshSessionTodos,
    refreshPendingInteractions,
    scheduleSessionRefresh,
  };
}

export type WorkspaceRefreshActions = ReturnType<typeof useWorkspaceRefreshActions>;
