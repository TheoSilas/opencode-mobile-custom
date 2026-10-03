import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';
import { toTranscriptEntry, type SessionMessageRecord } from '@/lib/opencode/format';
import { isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import type { SessionStatus } from '@/lib/opencode/types';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import { stopWorkingSoundAsync } from '@/lib/voice/working-sound';
import { getTranscript, getConversationStatusLabel, getTranscriptActivityLabelForEntries } from '@/providers/opencode-provider-selectors';
import { CONVERSATION_FINAL_RESULT_SETTLE_MS, CONVERSATION_KEEP_AWAKE_TAG, CONVERSATION_LISTENING_RESTART_MS,
  type ChatContextValue, type ChatPreferences, type ConnectionState, type ConversationPhase, type ConversationState } from '@/providers/opencode-provider-types';
import { useConversationKeepAwake } from '@/providers/use-conversation-keep-awake';
import { useConversationScreenDim } from '@/providers/use-conversation-screen-dim';

function applyConversationFeedback(
  setFeedback: (value: string | undefined) => void,
  setAction: (value: VoiceRecoveryAction) => void,
  message: string | undefined,
  action: VoiceRecoveryAction = 'none',
) {
  setFeedback(message);
  setAction(action);
}

export function useConversationState({ connection, chatPreferences, currentSessionId, setCurrentSessionId,
  sessionStatuses, messagesBySession, pendingPermissionsBySession, pendingQuestionsBySession,
  sendingState, ensureActiveSession, sendPrompt: sendPromptAction,
}: {
  connection: ConnectionState;
  chatPreferences: ChatPreferences;
  currentSessionId?: string;
  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>;
  sessionStatuses: Record<string, SessionStatus>;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
  sendingState: ChatContextValue['sendingState'];
  ensureActiveSession: () => Promise<string | undefined>;
  sendPrompt: ChatContextValue['sendPrompt'];
}) {
  const sendPromptRef = useRef(sendPromptAction);
  useLayoutEffect(() => { sendPromptRef.current = sendPromptAction; }, [sendPromptAction]);
  const sendPrompt = useCallback<ChatContextValue['sendPrompt']>((...args) => sendPromptRef.current(...args), []);
  const [conversationPhase, setConversationPhase] = useState<ConversationPhase>('off');
  const [conversationSessionId, setConversationSessionId] = useState<string>();
  const [queuedConversationPrompt, setQueuedConversationPrompt] = useState<string>();
  const [pendingConversationTurn, setPendingConversationTurn] = useState<string>();
  const [conversationFeedback, setConversationFeedback] = useState<string>();
  const [conversationFeedbackAction, setConversationFeedbackAction] = useState<VoiceRecoveryAction>('none');
  const [conversationLatestHeardText, setConversationLatestHeardText] = useState<string>();
  const conversationPhaseRef = useRef<ConversationPhase>('off');
  const assistantReplyBaselineIdRef = useRef<string | undefined>(undefined);
  const conversationResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationFinalResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationListeningRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationCancelRequestedRef = useRef(false);
  const conversationSubmittingRef = useRef(false);
  const pendingConversationTranscriptRef = useRef<string | undefined>(undefined);
  const flushPendingConversationResultRef = useRef<() => void>(() => undefined);
  const clearPendingConversationResult = useCallback(() => {
    pendingConversationTranscriptRef.current = undefined;
    if (conversationFinalResultTimeoutRef.current) {
      clearTimeout(conversationFinalResultTimeoutRef.current);
      conversationFinalResultTimeoutRef.current = undefined;
    }
  }, []);

  const speechInput = useSpeechInput({
    levelStep: 2,
    locale: chatPreferences.speechLocale,
    onResult: (transcript, isFinal) => {
      if (conversationPhaseRef.current !== 'listening') {
        return;
      }

      const nextTranscript = transcript.trim();
      if (!nextTranscript) {
        return;
      }

      pendingConversationTranscriptRef.current = nextTranscript;
      setConversationLatestHeardText(nextTranscript);
      if (conversationFinalResultTimeoutRef.current) {
        clearTimeout(conversationFinalResultTimeoutRef.current);
        conversationFinalResultTimeoutRef.current = undefined;
      }

      if (isFinal) {
        conversationFinalResultTimeoutRef.current = setTimeout(() => {
          conversationFinalResultTimeoutRef.current = undefined;
          flushPendingConversationResultRef.current();
        }, CONVERSATION_FINAL_RESULT_SETTLE_MS);
      }
    },
    preferOnDevice: chatPreferences.preferOnDeviceRecognition,
    volumeUpdateIntervalMillis: 400,
  });
  const {
    abort: abortSpeechInput,
    error: speechInputError,
    errorAction: speechInputErrorAction,
    errorCode: speechInputErrorCode,
    isListening: isConversationListening,
    isStarting: isConversationListeningStarting,
    level: conversationListeningLevel,
    start: startSpeechInput,
  } = speechInput;

  const flushPendingConversationResult = useCallback(() => {
    const transcript = pendingConversationTranscriptRef.current?.trim();
    clearPendingConversationResult();
    if (!transcript || conversationPhaseRef.current !== 'listening') {
      return;
    }

    conversationPhaseRef.current = 'submitting';
    conversationSubmittingRef.current = true;
    abortSpeechInput();
    setPendingConversationTurn(transcript);
    setConversationPhase('submitting');
  }, [abortSpeechInput, clearPendingConversationResult]);
  useLayoutEffect(() => { flushPendingConversationResultRef.current = flushPendingConversationResult; }, [flushPendingConversationResult]);

  // Stop the microphone when the app is backgrounded or the provider unmounts.
  // Without this, speech recognition stays active after the user switches apps,
  // continuing to capture audio in the background (privacy + battery cost).
  // abort() is safe to call when not listening — the underlying native call is
  // wrapped in try/catch inside useSpeechInput.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        abortSpeechInput();
      }
    });
    return () => {
      subscription.remove();
      abortSpeechInput();
    };
  }, [abortSpeechInput]);

  const getLatestConversationAssistantEntry = useCallback(
    (sessionId?: string) => {
      if (!sessionId) {
        return undefined;
      }

      const transcript = (messagesBySession[sessionId] || []).map(toTranscriptEntry).filter(isTranscriptDisplayMessage);
      return [...transcript].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim());
    },
    [messagesBySession],
  );

  const latestAssistantRef = useRef(getLatestConversationAssistantEntry);
  useLayoutEffect(() => { latestAssistantRef.current = getLatestConversationAssistantEntry; }, [getLatestConversationAssistantEntry]);

  const clearConversationFeedback = useCallback(() => {
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
  }, []);

  const stopConversationMode = useCallback(async () => {
    clearPendingConversationResult();
    if (conversationResumeTimeoutRef.current) {
      clearTimeout(conversationResumeTimeoutRef.current);
      conversationResumeTimeoutRef.current = undefined;
    }
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = true;
    conversationSubmittingRef.current = false;
    conversationPhaseRef.current = 'off';
    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    setConversationLatestHeardText(undefined);
    setConversationPhase('off');
    setConversationSessionId(undefined);
  }, [abortSpeechInput, clearPendingConversationResult]);

  const startConversationListening = useCallback(async (sessionId?: string) => {
    if (!sessionId && !conversationSessionId) {
      return false;
    }

    clearPendingConversationResult();
    if (conversationResumeTimeoutRef.current) {
      clearTimeout(conversationResumeTimeoutRef.current);
      conversationResumeTimeoutRef.current = undefined;
    }
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = false;
    conversationSubmittingRef.current = false;
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    await stopWorkingSoundAsync().catch(() => undefined);

    const started = await startSpeechInput({ continuous: true });
    if (!started) {
      conversationPhaseRef.current = 'off';
      setConversationPhase('off');
      return false;
    }

    conversationPhaseRef.current = 'listening';
    setConversationPhase('listening');
    return true;
  }, [clearPendingConversationResult, conversationSessionId, startSpeechInput]);

  const toggleConversationMode = useCallback(async () => {
    if (conversationPhase !== 'off') {
      await stopConversationMode();
      return;
    }

    if (connection.status !== 'connected') {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Connect to OpenCode before starting conversation mode.');
      return;
    }

    if (sendingState.active) {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Wait for the current reply to finish before starting conversation mode.');
      return;
    }

    const pendingInteractionCount = currentSessionId
      ? (pendingPermissionsBySession[currentSessionId] || []).length + (pendingQuestionsBySession[currentSessionId] || []).length
      : 0;
    if (pendingInteractionCount > 0) {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Answer the current request before starting conversation mode.');
      return;
    }

    const sessionId = currentSessionId || (await ensureActiveSession());
    if (!sessionId) {
      return;
    }

    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setCurrentSessionId(sessionId);
    setConversationSessionId(sessionId);
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    assistantReplyBaselineIdRef.current = getLatestConversationAssistantEntry(sessionId)?.id;
    const started = await startConversationListening(sessionId);
    if (!started) {
      setConversationSessionId(undefined);
    }
  }, [
    abortSpeechInput,
    connection.status,
    conversationPhase,
    currentSessionId,
    ensureActiveSession,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState.active,
    setCurrentSessionId,
    startConversationListening,
    stopConversationMode,
  ]);

  useEffect(() => {
    conversationPhaseRef.current = conversationPhase;
    if (conversationPhase !== 'submitting') {
      conversationSubmittingRef.current = false;
    }
  }, [conversationPhase]);

  useEffect(() => {
    if (conversationPhase !== 'listening' || isConversationListening || isConversationListeningStarting) {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
      return;
    }

    if (conversationCancelRequestedRef.current || conversationSubmittingRef.current) {
      return;
    }

    conversationListeningRestartTimeoutRef.current = setTimeout(() => {
      conversationListeningRestartTimeoutRef.current = undefined;
      if (
        conversationPhaseRef.current !== 'listening' ||
        conversationCancelRequestedRef.current ||
        conversationSubmittingRef.current
      ) {
        return;
      }

      void startConversationListening();
    }, CONVERSATION_LISTENING_RESTART_MS);

    return () => {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
    };
  }, [conversationPhase, isConversationListening, isConversationListeningStarting, startConversationListening]);

  useConversationKeepAwake(conversationPhase, CONVERSATION_KEEP_AWAKE_TAG);
  useConversationScreenDim(conversationPhase);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    if (
      conversationPhaseRef.current === 'listening' &&
      (speechInputErrorCode === 'client' || speechInputErrorCode === 'no-speech' || speechInputErrorCode === 'speech-timeout')
    ) {
      return;
    }

    applyConversationFeedback(
      setConversationFeedback,
      setConversationFeedbackAction,
      speechInputError,
      speechInputErrorAction,
    );
    if (conversationPhaseRef.current !== 'off') {
      void stopConversationMode();
    }
  }, [speechInputError, speechInputErrorAction, speechInputErrorCode, stopConversationMode]);

  useEffect(() => {
    if (conversationPhase !== 'submitting' || !pendingConversationTurn || !conversationSessionId) {
      return;
    }

    setQueuedConversationPrompt(pendingConversationTurn);
    setPendingConversationTurn(undefined);
  }, [conversationPhase, conversationSessionId, pendingConversationTurn]);

  useEffect(() => {
    if (conversationPhase !== 'submitting' || !queuedConversationPrompt || !conversationSessionId) {
      return;
    }

    let cancelled = false;

    const submitPrompt = async () => {
      try {
        assistantReplyBaselineIdRef.current = latestAssistantRef.current(conversationSessionId)?.id;
        await sendPrompt(conversationSessionId, queuedConversationPrompt);
        if (cancelled) {
          return;
        }

        if (conversationCancelRequestedRef.current || conversationPhaseRef.current === 'off') {
          setQueuedConversationPrompt(undefined);
          setPendingConversationTurn(undefined);
          return;
        }

        setQueuedConversationPrompt(undefined);
        setConversationPhase('waiting');
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Voice conversation failed while sending your message.';
        setQueuedConversationPrompt(undefined);
        setPendingConversationTurn(undefined);
        applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, message);
        await stopConversationMode();
      }
    };

    void submitPrompt();

    return () => {
      cancelled = true;
    };
  }, [
    conversationPhase,
    conversationSessionId,
    queuedConversationPrompt,
    sendPrompt,
    stopConversationMode,
  ]);

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
    chatPreferences.resumeListeningAfterReply,
    chatPreferences.speechLocale,
    chatPreferences.speechRate,
    chatPreferences.speechVoiceId,
    conversationPhase,
    conversationSessionId,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState.active,
    sendingState.sessionId,
    sessionStatuses,
    startConversationListening,
    stopConversationMode,
  ]);

  useEffect(() => {
    if (conversationPhase === 'off' || connection.status === 'connected') {
      return;
    }

    applyConversationFeedback(
      setConversationFeedback,
      setConversationFeedbackAction,
      connection.message || 'OpenCode disconnected. Conversation mode will resume when the connection returns.',
    );
  }, [connection.message, connection.status, conversationPhase]);

  useEffect(() => {
    if (connection.status !== 'connected') {
      return;
    }

    setConversationFeedback((current) => {
      if (!current) {
        return current;
      }

      if (current === connection.message || current.includes('resume when the connection returns')) {
        return undefined;
      }

      return current;
    });
  }, [connection.message, connection.status]);

  const conversationMessages = useMemo(
    () => (conversationSessionId ? messagesBySession[conversationSessionId] || [] : []),
    [conversationSessionId, messagesBySession],
  );
  const conversationTranscript = useMemo(() => getTranscript(conversationMessages), [conversationMessages]);
  const conversationCurrentActivityLabel = useMemo(() => getTranscriptActivityLabelForEntries(conversationTranscript), [conversationTranscript]);
  const conversationActive = conversationPhase !== 'off';
  const conversationStatusLabel = useMemo(() => getConversationStatusLabel(conversationPhase, conversationCurrentActivityLabel), [conversationCurrentActivityLabel, conversationPhase]);
  // The conversation snapshot is memoized so the ConversationContext value only
  // changes when a conversation field changes.
  const conversation = useMemo<ConversationState>(
    () => ({
      active: conversationActive,
      feedback: conversationFeedback,
      feedbackAction: conversationFeedbackAction,
      isListening: isConversationListening,
      level: conversationListeningLevel,
      latestHeardText: conversationLatestHeardText,
      phase: conversationPhase,
      sessionId: conversationSessionId,
      statusLabel: conversationStatusLabel,
    }),
    [conversationActive, conversationFeedback, conversationFeedbackAction, isConversationListening, conversationListeningLevel, conversationLatestHeardText, conversationPhase, conversationSessionId, conversationStatusLabel],
  );

  useEffect(() => () => {
    if (conversationResumeTimeoutRef.current) clearTimeout(conversationResumeTimeoutRef.current);
    if (conversationFinalResultTimeoutRef.current) clearTimeout(conversationFinalResultTimeoutRef.current);
    if (conversationListeningRestartTimeoutRef.current) clearTimeout(conversationListeningRestartTimeoutRef.current);
    void stopSpeaking().catch(() => undefined);
  }, []);

  return { conversation, clearConversationFeedback, toggleConversationMode };
}
