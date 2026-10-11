import { describe, expect, it } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

describe('transcript history paging', () => {
  it('loads past the live-tail cap and keeps requested history through a tail refresh', async () => {
    const runtime = hookRuntime();
    const record = (id: number) => ({ info: { id: `message-${id}` }, parts: [] });
    const calls: string[] = [];
    const { useTranscriptState } = await loadTs('providers/use-transcript-state.ts', {
      react: runtime.react,
      '@/lib/opencode/format': {
        hasTodoWritePart: () => false,
        mergeSessionMessageWindow: (old: any[], fresh: any[]) => {
          const ids = new Set(fresh.map((item) => item.info.id));
          return [...old.filter((item) => !ids.has(item.info.id)), ...fresh];
        },
        prependSessionMessageHistory: (old: any[], older: any[]) => {
          const ids = new Set(old.map((item) => item.info.id));
          return [...older.filter((item) => !ids.has(item.info.id)), ...old];
        },
      },
      '@/lib/opencode/usage': { addUsageSteps: () => {} },
      '@/providers/services/session-service': {
        INITIAL_MESSAGE_LIMIT: 20,
        HISTORY_PAGE_LIMIT: 20,
        getSessionMessages: async (_client: unknown, _session: string, options: { before?: string }) => {
          calls.push(options.before ?? 'newest');
          if (!options.before) return { records: Array.from({ length: 200 }, (_, id) => record(id + 20)), hasMore: true, nextBefore: 'older' };
          return { records: Array.from({ length: 20 }, (_, id) => record(id)), hasMore: false };
        },
      },
    });
    const client = {};
    runtime.mount(() => {
      const [messagesBySession, setMessagesBySession] = runtime.react.useState({} as Record<string, any[]>);
      const [refreshing, setRefreshing] = runtime.react.useState(false);
      const transcript = useTranscriptState({ client, isCurrentClient: () => true, messagesBySession, setMessagesBySession, setIsRefreshingMessages: setRefreshing });
      return { ...transcript, messagesBySession, refreshing };
    }, {});
    await runtime.value.refreshMessages('session');
    runtime.flush();
    expect(runtime.value.messagesBySession.session).toHaveLength(200);
    await runtime.value.loadOlderMessages('session');
    runtime.flush();
    expect(runtime.value.messagesBySession.session).toHaveLength(220);
    expect(runtime.value.messagesBySession.session[0].info.id).toBe('message-0');
    await runtime.value.refreshMessages('session');
    runtime.flush();
    expect(runtime.value.messagesBySession.session[0].info.id).toBe('message-0');
    expect(calls).toEqual(['newest', 'older', 'newest']);
  });
});
