import type { FilePartInput, TextPartInput } from '@opencode-ai/sdk/v2/client';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { OpencodeConnectionSettings, ScopedOpencodeClient } from '@/lib/opencode/client';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { Session, SessionStatus } from '@/lib/opencode/types';
import type { PromptDelivery, PromptInput } from '@/lib/opencode/prompt-inbox';
import { pendingNotificationKey } from '@/lib/notification-pending';
import {
  clearPendingTaskFinishedNotification,
  notifyTaskFinished,
  trackPendingTaskFinishedNotification,
} from '@/lib/notifications';
import type { ModelOption } from '@/providers/opencode-model-selection';
import { getSelectedModelParts } from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import { buildSystemPrompt } from '@/providers/opencode-preferences';
import type { SessionRefreshOptions } from '@/providers/opencode-provider-events';
import type { useProjectMemory } from '@/providers/use-project-memory';
import type { usePersonalMemory } from '@/providers/use-personal-memory';

type TrackedPendingNotification = {
  sessionId: string;
  connectionScope: string;
  requestedAt: number;
};

type PromptLifecycleInput = {
  submitPrompt: (input: PromptInput, delivery: PromptDelivery) => Promise<void>;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  activeProjectPath?: string;
  connectionScope: string;
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error' };
  availableModels: ModelOption[];
  chatPreferences: ChatPreferences;
  settingsRef: { current: OpencodeConnectionSettings };
  pendingNotificationsRef: { current: Map<string, TrackedPendingNotification> };
  busyNotificationsRef: { current: Set<string> };
  promptSubmissionRef: { current: { active: boolean; sessionId?: string } };
  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedDiffMessageBySession: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  fetchSessions: (silent?: boolean) => Promise<Session[]>;
  refreshSessions: (silent?: boolean) => Promise<unknown>;
  refreshMessages: (sessionId: string, silent?: boolean, options?: { full?: boolean }) => Promise<SessionMessageRecord[]>;
  refreshSessionDiff: (sessionId: string, silent?: boolean, messageId?: string) => Promise<unknown>;
  refreshSessionTodos: (sessionId: string) => Promise<unknown>;
  scheduleSessionRefresh: (sessionId: string, options?: SessionRefreshOptions) => void;
  summarizeSessionTitle: (sessionId: string, knownSessions?: Session[]) => Promise<Session | undefined>;
  projectMemory: Pick<ReturnType<typeof useProjectMemory>, 'introFor' | 'markSent'>;
  personalMemory: Pick<ReturnType<typeof usePersonalMemory>, 'intro' | 'learn'>;
};

export function usePromptLifecycle({
  submitPrompt,
  client,
  isCurrentClient,
  activeProjectPath,
  connectionScope,
  sessions,
  sessionStatuses,
  connection,
  availableModels,
  chatPreferences,
  settingsRef,
  pendingNotificationsRef,
  busyNotificationsRef,
  promptSubmissionRef,
  setCurrentSessionId,
  setSelectedDiffMessageBySession,
  fetchSessions,
  refreshSessions,
  refreshMessages,
  refreshSessionDiff,
  refreshSessionTodos,
  scheduleSessionRefresh,
  summarizeSessionTitle,
  projectMemory,
  personalMemory,
}: PromptLifecycleInput) {
  const [sendingState, setSendingState] = useState<{ sessionId?: string; active: boolean }>({ active: false });
  const [promptError, setPromptError] = useState<{ message: string; occurredAt: number; sessionId?: string }>();
  const [stopConfirmation, setStopConfirmation] = useState<{ sessionId: string; scope: string; phase: 'requesting' | 'checking' | 'unknown' }>();
  const latestPromptBySession = useRef(new Map<string, number>());

  const sendPrompt = useCallback(
    async (
      sessionId: string,
      prompt: string,
      attachments?: { uri: string; mime?: string; filename?: string }[],
    ) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt && (!attachments || attachments.length === 0)) {
        return false;
      }

      if (promptSubmissionRef.current.active || (stopConfirmation?.sessionId === sessionId && stopConfirmation.scope === connectionScope)) {
        return false;
      }

      promptSubmissionRef.current = { active: true, sessionId };
      setPromptError(undefined);

      const currentSession = sessions.find((session) => session.id === sessionId);
      let promptAccepted = false;
      const trackingKey = pendingNotificationKey(connectionScope, sessionId);
      const requestedAt = Date.now();

      try {
        busyNotificationsRef.current.delete(trackingKey);
        pendingNotificationsRef.current.set(trackingKey, { sessionId, connectionScope, requestedAt });
        if (activeProjectPath) {
          await trackPendingTaskFinishedNotification({
            sessionId,
            sessionTitle: currentSession?.title,
            projectPath: activeProjectPath,
            connectionScope,
            settings: {
              serverUrl: settingsRef.current.serverUrl,
              username: settingsRef.current.username,
            },
            requestedAt,
          }).catch(() => undefined);
        }

        setSendingState({ active: true, sessionId });
        const selectedModel = availableModels.find((model) => model.id === chatPreferences.modelId);
        if (attachments?.length && !selectedModel) {
          throw new Error('Select a model that supports attachments first.');
        }
        if (attachments?.length && !selectedModel?.supportsAttachments) {
          throw new Error(`${selectedModel?.label || 'The selected model'} does not support file attachments.`);
        }
        if (attachments?.length && selectedModel?.inputModalities?.length) {
          const unsupported = attachments.find((attachment) => {
            const mime = attachment.mime || '';
            const modality = mime.startsWith('image/') ? 'image'
              : mime.startsWith('audio/') ? 'audio'
                : mime.startsWith('video/') ? 'video'
                  : mime === 'application/pdf' ? 'pdf'
                    : undefined;
            return modality && !selectedModel.inputModalities.includes(modality);
          });
          if (unsupported) {
            throw new Error(`${selectedModel.label} does not support ${unsupported.mime || 'this attachment type'} input.`);
          }
        }

        // Prepare file parts. For local URIs (file://, content://, asset://) read the
        // file and convert it to a data URL so the server receives the attachment bytes.
        // Mobile-local URIs are not reachable from the OpenCode server.
        const preparedFileParts: { type: 'file'; mime: string; filename?: string; url: string }[] = [];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            const filename = att.filename || att.uri.split('/').pop();
            const mime = att.mime || 'application/octet-stream';

            // Remote and picker-provided data URLs are already server-readable.
            if (/^(?:https?:\/\/|data:)/i.test(att.uri)) {
              preparedFileParts.push({ type: 'file', mime, filename, url: att.uri });
              continue;
            }

            try {
              const { readLocalAttachmentDataUrl } = await import('@/lib/attachment-preview');
              const dataUrl = await readLocalAttachmentDataUrl(att.uri, mime);
              preparedFileParts.push({ type: 'file', mime, filename, url: dataUrl });
            } catch (error) {
              const reason = error instanceof Error ? error.message : 'unknown error';
              throw new Error(`Could not read attachment${filename ? ` \"${filename}\"` : ''}: ${reason}`);
            }
          }
        }

        const parts: (TextPartInput | FilePartInput)[] = [];
        const handoff = await projectMemory.introFor(sessionId);
        const personal = await personalMemory.intro().catch(() => '');
        if (!isCurrentClient(client)) return false;
        if (trimmedPrompt || handoff) {
          parts.push({ type: 'text', text: handoff ? `${handoff}\n\n${trimmedPrompt}` : trimmedPrompt });
        }
        parts.push(...preparedFileParts);

        const credentialID = (sessions.find((session) => session.id === sessionId) as (Session & { credentialID?: string }) | undefined)?.credentialID;
        if (credentialID && client.accounts) {
          const accounts = await client.accounts.list();
          if (!isCurrentClient(client)) return false;
          if (!accounts.some((account) => account.id === credentialID)) {
            throw new Error('This chat account is no longer available. Select an available account before sending.');
          }
        }
        await submitPrompt({
          sessionID: sessionId,
          ...(credentialID ? { credentialID } : {}),
          agent: chatPreferences.mode,
          model: getSelectedModelParts(chatPreferences.modelId),
          system: [buildSystemPrompt(chatPreferences), personal].filter(Boolean).join('\n\n') || undefined,
          parts,
        }, chatPreferences.promptDelivery ?? 'steer');
        promptAccepted = true;
        setStopConfirmation((current) => current?.sessionId === sessionId && current.scope === connectionScope ? undefined : current);
        latestPromptBySession.current.set(sessionId, requestedAt);
        // Native SSE may miss a failure emitted after the HTTP admission succeeds.
        // Observe the durable V2 terminal outcome as a bounded safety fallback.
        const accountsClient = client.accounts;
        if (client.session.get) {
          void (async () => {
            for (let attempt = 0; attempt < 40; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 3_000));
              if (!isCurrentClient(client) || latestPromptBySession.current.get(sessionId) !== requestedAt) return;
              try {
                const response = await client.session.get({ sessionID: sessionId });
                const settled = response.data as Session & { outcome?: string; time?: { idle?: number } };
                if (!settled || !settled.time?.idle || settled.time.idle < requestedAt) continue;
                if (settled.outcome === 'failed') {
                  const stillAvailable = credentialID && accountsClient
                    ? await accountsClient.list()
                      .then((accounts) => accounts.some((account) => account.id === credentialID))
                      .catch(() => true)
                    : undefined;
                  if (!isCurrentClient(client) || latestPromptBySession.current.get(sessionId) !== requestedAt) return;
                  setPromptError((current) => current?.sessionId === sessionId ? current : {
                    message: stillAvailable === false
                      ? 'This chat account is no longer available. Select an available account before sending.'
                      : 'OpenCode could not complete this task. Check the account and try again.',
                    occurredAt: Date.now(), sessionId,
                  });
                }
                if (settled.outcome) {
                  latestPromptBySession.current.delete(sessionId);
                  return;
                }
              } catch {
                // Transient status reads do not replace the existing SSE path.
              }
            }
            if (latestPromptBySession.current.get(sessionId) === requestedAt) latestPromptBySession.current.delete(sessionId);
          })();
        }
        if (handoff) projectMemory.markSent(sessionId);
        if (isCurrentClient(client) && trimmedPrompt) {
          void personalMemory.learn(client, trimmedPrompt, chatPreferences.modelId).catch(() => undefined);
        }
        if (promptSubmissionRef.current.sessionId === sessionId) {
          promptSubmissionRef.current = { active: false, sessionId: undefined };
        }
        if (!isCurrentClient(client)) {
          return true;
        }
        // Delayed safety refresh. The server may finish after promptAsync
        // returns, and a completion across workspaces can be missed when the
        // event directory does not match the active project. Re-read the
        // transcript once after the typical completion window so the busy
        // safety poll can run at a slower, lower-data cadence.
        scheduleSessionRefresh(sessionId, { sessions: true, messages: true, fullMessages: true, diff: true, todos: true, delayMs: 5000 });

        setCurrentSessionId(sessionId);
        // A new user turn supersedes any earlier turn the diff surface was pinned to.
        setSelectedDiffMessageBySession((current) => ({ ...current, [sessionId]: undefined }));
        const nextSessions = await fetchSessions(true);
        await Promise.all([
          refreshMessages(sessionId, true),
          refreshSessionDiff(sessionId, true),
          refreshSessionTodos(sessionId),
        ]);

        const refreshedSession = nextSessions.find((session) => session.id === sessionId);
        if (!refreshedSession?.title?.trim()) {
          try {
            await summarizeSessionTitle(sessionId, nextSessions);
          } catch {
            // Leave the session untitled if summarization is unavailable.
          }
        }
        return true;
      } catch (error) {
        if (promptSubmissionRef.current.sessionId === sessionId) {
          promptSubmissionRef.current = { active: false, sessionId: undefined };
        }
        if (promptAccepted) {
          scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 1000 });
          return true;
        }
        setPromptError({
          message: error instanceof Error ? error.message : 'OpenCode could not send that message.',
          occurredAt: Date.now(),
          sessionId,
        });
        if (!promptAccepted) {
          pendingNotificationsRef.current.delete(trackingKey);
          await clearPendingTaskFinishedNotification(connectionScope, sessionId).catch(() => undefined);
        }

        throw error;
      } finally {
        setSendingState((current) => (
          current.sessionId === sessionId
            ? { active: false, sessionId: undefined }
            : current
        ));
      }
    },
    [activeProjectPath, availableModels, busyNotificationsRef, chatPreferences, client, connectionScope, fetchSessions, isCurrentClient, pendingNotificationsRef, personalMemory, projectMemory, promptSubmissionRef, refreshMessages, refreshSessionDiff, refreshSessionTodos, scheduleSessionRefresh, sessions, setCurrentSessionId, setPromptError, setSelectedDiffMessageBySession, settingsRef, stopConfirmation, submitPrompt, summarizeSessionTitle],
  );

  const confirmStop = useCallback(async (sessionId: string, scope: string) => {
    if (!isCurrentClient(client) || scope !== connectionScope || connection.status !== 'connected') {
      setStopConfirmation((current) => current?.sessionId === sessionId && current.scope === scope ? { ...current, phase: 'unknown' } : current);
      return;
    }
    try {
      const response = await client.session.status();
      if (!isCurrentClient(client) || scope !== connectionScope) return;
      if (response.data?.[sessionId]?.type !== 'idle') return;
      // A fresh server read, rather than the last cached SSE state, confirms
      // the execution is no longer active.
      await refreshSessions(true);
      if (!isCurrentClient(client)) return;
      const trackingKey = pendingNotificationKey(scope, sessionId);
      pendingNotificationsRef.current.delete(trackingKey);
      busyNotificationsRef.current.delete(trackingKey);
      latestPromptBySession.current.delete(sessionId);
      await clearPendingTaskFinishedNotification(scope, sessionId).catch(() => undefined);
      if (promptSubmissionRef.current.sessionId === sessionId) promptSubmissionRef.current = { active: false, sessionId: undefined };
      setSendingState((current) => current.sessionId === sessionId ? { active: false, sessionId: undefined } : current);
      await Promise.all([refreshMessages(sessionId, true), refreshSessionDiff(sessionId, true), refreshSessionTodos(sessionId)]);
      setStopConfirmation((current) => current?.sessionId === sessionId && current.scope === scope ? undefined : current);
    } catch {
      if (isCurrentClient(client)) setStopConfirmation((current) => current?.sessionId === sessionId && current.scope === scope ? { ...current, phase: 'unknown' } : current);
    }
  }, [busyNotificationsRef, client, connection.status, connectionScope, isCurrentClient, pendingNotificationsRef, promptSubmissionRef, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions]);

  const stopSessionId = stopConfirmation?.sessionId;
  const stopScope = stopConfirmation?.scope;
  const stopPhase = stopConfirmation?.phase;
  useEffect(() => {
    if (!stopSessionId || stopPhase === 'requesting' || stopScope !== connectionScope || connection.status !== 'connected') return;
    // A missed response or lost SSE never counts as confirmation. Re-read on
    // reconnection and at a bounded cadence until the server becomes idle.
    const initial = setTimeout(() => { void confirmStop(stopSessionId, stopScope); }, 0);
    const interval = setInterval(() => { void confirmStop(stopSessionId, stopScope); }, 5_000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [confirmStop, connection.status, connectionScope, stopSessionId, stopScope, stopPhase]);

  const abortSession = useCallback(
    async (sessionId: string) => {
      if (connection.status !== 'connected') {
        setStopConfirmation({ sessionId, scope: connectionScope, phase: 'unknown' });
        return;
      }
      setStopConfirmation({ sessionId, scope: connectionScope, phase: 'requesting' });
      try {
        await client.session.abort({ sessionID: sessionId });
        if (!isCurrentClient(client)) return;
        setStopConfirmation((current) => current?.sessionId === sessionId && current.scope === connectionScope ? { ...current, phase: 'checking' } : current);
        await confirmStop(sessionId, connectionScope);
      } catch (error) {
        setStopConfirmation((current) => current?.sessionId === sessionId && current.scope === connectionScope ? { ...current, phase: 'unknown' } : current);
        throw error;
      }
    },
    [client, connection.status, connectionScope, confirmStop, isCurrentClient],
  );

  useEffect(() => {
    Object.entries(sessionStatuses).forEach(([sessionId, status]) => {
      const key = pendingNotificationKey(connectionScope, sessionId);
      if (status.type !== 'idle' && pendingNotificationsRef.current.has(key)) {
        busyNotificationsRef.current.add(key);
      }
    });
  }, [busyNotificationsRef, connectionScope, pendingNotificationsRef, sessionStatuses]);

  useEffect(() => {
    let cancelled = false;

    async function flushCompletedNotifications() {
      const pendingEntries = [...pendingNotificationsRef.current.entries()]
        .filter(([, pending]) => pending.connectionScope === connectionScope);
      if (pendingEntries.length === 0) {
        return;
      }

      for (const [key, pending] of pendingEntries) {
        const { sessionId } = pending;
        if (stopConfirmation?.sessionId === sessionId && stopConfirmation.scope === connectionScope) continue;
        const status = sessionStatuses[sessionId];
        const oldEnough = Date.now() - pending.requestedAt >= 5000;
        if ((!busyNotificationsRef.current.has(key) && !oldEnough) || (status && status.type !== 'idle') || (sendingState.active && sendingState.sessionId === sessionId)) {
          continue;
        }

        const session = sessions.find((item) => item.id === sessionId);
        if (!session) {
          pendingNotificationsRef.current.delete(key);
          busyNotificationsRef.current.delete(key);
          await clearPendingTaskFinishedNotification(connectionScope, sessionId).catch(() => undefined);
          continue;
        }
        const cleared = await clearPendingTaskFinishedNotification(connectionScope, sessionId, pending.requestedAt);
        if (cancelled) {
          return;
        }

        pendingNotificationsRef.current.delete(key);
        busyNotificationsRef.current.delete(key);
        if (cleared) await notifyTaskFinished(session.title, connectionScope);
      }
    }

    void flushCompletedNotifications().catch((reason) => console.warn('Could not complete task notification.', reason));

    return () => {
      cancelled = true;
    };
  }, [busyNotificationsRef, connectionScope, pendingNotificationsRef, sendingState.active, sendingState.sessionId, sessionStatuses, sessions, stopConfirmation]);

  const clearPromptError = useCallback(() => setPromptError(undefined), []);

  return {
    sendPrompt,
    abortSession,
    sendingState: { ...sendingState, stopConfirmation: stopConfirmation?.scope === connectionScope ? stopConfirmation : undefined },
    setSendingState,
    promptError,
    setPromptError,
    clearPromptError,
  };
}
