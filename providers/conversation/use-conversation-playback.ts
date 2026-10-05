import { useEffect, type Dispatch, type SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';
import type { TranscriptEntry } from '@/lib/opencode/format';
import type { SessionStatus } from '@/lib/opencode/types';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import { speakText } from '@/lib/voice/speech-output';
import { stopWorkingSoundAsync } from '@/lib/voice/working-sound';
import type { ConversationPhase } from '@/providers/opencode-provider-types';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import { applyConversationFeedback } from '@/providers/conversation/feedback';

export function useConversationPlayback({
  chatPreferences,
  conversationPhase,
  conversationSessionId,
  pendingPermissionsBySession,
  pendingQuestionsBySession,
  sessionStatuses,
  sendingState,
  getLatestConversationAssistantEntry,
  assistantReplyBaselineIdRef,
  conversationResumeTimeoutRef,
  conversationPhaseRef,
  startConversationListening,
  stopConversationMode,
  setConversationPhase,
  setConversationFeedback,
  setConversationFeedbackAction,
}: {
  chatPreferences: ChatPreferences;
  conversationPhase: ConversationPhase;
  conversationSessionId?: string;
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
  sessionStatuses: Record<string, SessionStatus>;
  sendingState: { sessionId?: string; active: boolean };
  getLatestConversationAssistantEntry: (sessionId?: string) => TranscriptEntry | undefined;
  assistantReplyBaselineIdRef: { current: string | undefined };
  conversationResumeTimeoutRef: { current: ReturnType<typeof setTimeout> | undefined };
  conversationPhaseRef: { current: ConversationPhase };
  startConversationListening: (sessionId?: string) => Promise<boolean | void>;
  stopConversationMode: () => Promise<void>;
  setConversationPhase: Dispatch<SetStateAction<ConversationPhase>>;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
}) {
  useEffect(() => {
    if (conversationPhase !== 'waiting') {
      return;
    }

    const pendingInteractions = conversationSessionId
      ? (pendingPermissionsBySession[conversationSessionId] || []).length + (pendingQuestionsBySession[conversationSessionId] || []).length
      : 0;
    const latestAssistantEntry = getLatestConversationAssistantEntry(conversationSessionId);
    const sessionStatus = conversationSessionId ? sessionStatuses[conversationSessionId] : undefined;
    const isSessionRunning = conversationSessionId
      ? sendingState.sessionId === conversationSessionId || sendingState.active || (!!sessionStatus && sessionStatus.type !== 'idle')
      : false;

    if (pendingInteractions > 0) {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Conversation mode paused because the assistant needs your input on screen.');
      void stopConversationMode();
      return;
    }

    if (isSessionRunning) {
      return () => {
        void stopWorkingSoundAsync().catch(() => undefined);
      };
    }

    void stopWorkingSoundAsync().catch(() => undefined);
    if (latestAssistantEntry && latestAssistantEntry.id !== assistantReplyBaselineIdRef.current) {
      void (async () => {
        const started = await speakText({
          language: chatPreferences.speechLocale,
          onDone: () => {
            if (conversationPhaseRef.current !== 'off' && chatPreferences.resumeListeningAfterReply) {
              void startConversationListening();
            } else {
              void stopConversationMode();
            }
          },
          onError: () => {
            applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Unable to play this assistant reply.');
            void stopConversationMode();
          },
          onStart: () => {
            setConversationPhase('speaking');
          },
          rate: chatPreferences.speechRate,
          text: latestAssistantEntry.text,
          voice: chatPreferences.speechVoiceId,
        });

        if (!started) {
          if (chatPreferences.resumeListeningAfterReply) {
            void startConversationListening();
          } else {
            void stopConversationMode();
          }
        }
      })();
      return;
    }

    conversationResumeTimeoutRef.current = setTimeout(() => {
      if (conversationPhaseRef.current === 'waiting' && !isSessionRunning) {
        void startConversationListening();
      }
    }, 1200);

    return () => {
      if (conversationResumeTimeoutRef.current) {
        clearTimeout(conversationResumeTimeoutRef.current);
        conversationResumeTimeoutRef.current = undefined;
      }
    };
  }, [
    assistantReplyBaselineIdRef,
    chatPreferences.resumeListeningAfterReply,
    chatPreferences.speechLocale,
    chatPreferences.speechRate,
    chatPreferences.speechVoiceId,
    conversationPhase,
    conversationPhaseRef,
    conversationResumeTimeoutRef,
    conversationSessionId,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState.active,
    sendingState.sessionId,
    sessionStatuses,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationPhase,
    startConversationListening,
    stopConversationMode,
  ]);
}
