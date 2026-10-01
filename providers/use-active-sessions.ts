import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { Session, SessionStatus } from '@/lib/opencode/types';
import { getActiveSessions } from '@/providers/active-sessions';
import { listActiveSessions as svcListActiveSessions } from '@/providers/services/session-service';

const ACTIVE_SESSIONS_POLL_MS = 5000;
const MAX_ACTIVE = 4;

type ActiveSessionsSnapshot = {
  scope?: string;
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
};

// Cross-workspace session snapshot for the Chat Library "Active" group. It reads
// through the unscoped catalog client so it sees every project on the active
// connection, seeds on connect, and polls only while a remote session is
// running. The snapshot is tagged with its connection scope, so a server switch
// immediately hides the previous server's sessions without a reset effect.
export function useActiveSessions({
  catalogClient,
  isCurrentCatalogClient,
  connectionScope,
  connected,
  currentSessionId,
  hideSubagentChats,
}: {
  catalogClient: ScopedOpencodeClient;
  isCurrentCatalogClient: (candidate: object) => boolean;
  connectionScope: string;
  connected: boolean;
  currentSessionId?: string;
  hideSubagentChats: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ActiveSessionsSnapshot>({ sessions: [], statuses: {} });

  const refreshActiveSessions = useCallback(async () => {
    if (!connected) {
      return;
    }
    try {
      const result = await svcListActiveSessions(catalogClient);
      if (!isCurrentCatalogClient(catalogClient)) {
        return;
      }
      setSnapshot({
        scope: connectionScope,
        sessions: result.sessions as Session[],
        statuses: result.statuses as Record<string, SessionStatus>,
      });
    } catch {
      // Keep the previous snapshot on a transient failure.
    }
  }, [catalogClient, connected, connectionScope, isCurrentCatalogClient]);

  const current = snapshot.scope === connectionScope ? snapshot : undefined;
  const activeSessions = useMemo(() => getActiveSessions({
    sessions: current?.sessions ?? [],
    statuses: current?.statuses ?? {},
    currentSessionId,
    hideSubagentChats,
    maxTotal: MAX_ACTIVE,
  }), [current, currentSessionId, hideSubagentChats]);

  const hasRunning = activeSessions.some((session) => session.status.type !== 'idle');
  useEffect(() => {
    if (!connected || !hasRunning) {
      return;
    }
    const interval = setInterval(() => {
      void refreshActiveSessions();
    }, ACTIVE_SESSIONS_POLL_MS);
    return () => clearInterval(interval);
  }, [connected, hasRunning, refreshActiveSessions]);

  return { activeSessions, refreshActiveSessions };
}
