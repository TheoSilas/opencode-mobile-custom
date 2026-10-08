import { useCallback } from 'react';

import {
  rejectPendingQuestion,
  replyToPendingPermission,
  replyToPendingQuestion,
  type PendingQuestionAnswer,
} from '@/lib/opencode/client';
import type { SessionActionsInput } from '@/providers/opencode-provider-action-inputs';

export function useSessionInteractionActions({
  client,
  pendingPermissionsBySession,
  pendingQuestionsBySession,
  setPendingPermissionsBySession,
  setPendingQuestionsBySession,
  refreshMessages,
  refreshSavedPermissions,
}: SessionActionsInput) {
  const replyToPermission = useCallback(
    async (requestId: string, reply: 'once' | 'always' | 'reject') => {
      const request = Object.values(pendingPermissionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This permission request is no longer available.');
      }
      await replyToPendingPermission(client, request.id, reply);
      setPendingPermissionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
      // An "always" reply may persist a new server-side rule; refresh the list.
      if (reply === 'always' && refreshSavedPermissions) {
        void refreshSavedPermissions().catch(() => undefined);
      }
    },
    [client, pendingPermissionsBySession, refreshMessages, refreshSavedPermissions, setPendingPermissionsBySession],
  );

  const replyToQuestion = useCallback(
    async (requestId: string, answers: PendingQuestionAnswer[]) => {
      const request = Object.values(pendingQuestionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This question is no longer available.');
      }
      await replyToPendingQuestion(client, request.id, answers);
      setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
    },
    [client, pendingQuestionsBySession, refreshMessages, setPendingQuestionsBySession],
  );

  const rejectQuestion = useCallback(
    async (requestId: string) => {
      const request = Object.values(pendingQuestionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This question is no longer available.');
      }
      await rejectPendingQuestion(client, request.id);
      setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
    },
    [client, pendingQuestionsBySession, refreshMessages, setPendingQuestionsBySession],
  );

  return { replyToPermission, replyToQuestion, rejectQuestion };
}
