import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Button, Card, Snackbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatContent } from '@/components/chat/chat-content';
import { ChatHeader } from '@/components/chat/chat-header';
import { ChatLibrary } from '@/components/chat/chat-library';
import { TopTab } from '@/components/chat/chat-controls';
import { styles } from '@/components/chat/chat-view-styles';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { normalizeTranscriptFontSize } from '@/providers/opencode-preferences';
import { type TranscriptEntry } from '@/lib/opencode/format';
import { getTranscriptActivityLabel, isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import { getLatestContextTokens } from '@/lib/opencode/usage';
import { openVoiceSettingsAsync } from '@/lib/voice/permissions';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import {
  useCapabilities,
  useChat,
  useConnection,
  useConversation,
  usePreferences,
  useSessions,
  useWorkspace,
} from '@/providers/opencode-contexts';

export function ChatView() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { activeProject } = useWorkspace();
  const {
    activeSession, createSession, currentSessionId, ensureActiveSession, forkSession, openSession,
    revertSession, sessionStatuses, sessions, unrevertSession,
  } = useSessions();
  const { availableAgents, availableModels, configuredProviders } = useCapabilities();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const slim = chatPreferences.slimInterface === true;
  const { connection, settings, serverCapabilities } = useConnection();
  const { conversation, clearConversationFeedback, toggleConversationMode } = useConversation();
  const {
    abortSession, clearPromptError, commands, currentDiffs, currentDiffScope, currentMessages,
    currentPendingPermissions, currentPendingQuestions, currentTodos, currentTranscript, currentUsage,
    diffTurns, executeCommand, isRefreshingDiffs, isRefreshingMessages, latestAssistantTurnUsage,
    promptError, refreshCurrentSession, refreshDiffs, rejectQuestion, replyToPermission, replyToQuestion,
    selectDiffMessage, selectedDiffMessageId, sendPrompt, sendingState, setAutoApprove, setDiffScope,
  } = useChat();

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<{ uri: string; mime?: string; filename?: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'session' | 'changes'>('session');
  const [sessionMenuVisible, setSessionMenuVisible] = useState(false);
  const [isUpdatingAutoApprove, setIsUpdatingAutoApprove] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [expandedDiffId, setExpandedDiffId] = useState<string | undefined>();
  const [copiedMessageId, setCopiedMessageId] = useState<string | undefined>();
  const [speakingMessageId, setSpeakingMessageId] = useState<string | undefined>(undefined);
  const [voiceFeedback, setVoiceFeedback] = useState<string | undefined>(undefined);
  const [sendFeedback, setSendFeedback] = useState<string | undefined>(undefined);
  const speechDraftPrefixRef = useRef('');
  const conversationActiveRef = useRef(false);
  const voiceRecoveryContextRef = useRef<'conversation' | 'dictation'>('dictation');
  const draftRef = useRef('');
  const attachmentsRef = useRef<{ uri: string; mime?: string; filename?: string }[]>([]);
  const lastSentAttachmentsRef = useRef<{ uri: string; mime?: string; filename?: string }[]>([]);
  const lastAutoSpokenMessageIdRef = useRef<string | undefined>(undefined);

  const status = currentSessionId ? sessionStatuses[currentSessionId] : undefined;
  const running = sendingState.active || (!!status && status.type !== 'idle');
  const conversationActive = conversation.active;
  const hasDraftInput = !!draft.trim() || attachments.length > 0;
  const showSendAction = !running || hasDraftInput;
  const visibleModels = useMemo(() => {
    const configuredProviderIds = new Set(configuredProviders.map((provider) => provider.id));
    const enabledModelIds = new Set(chatPreferences.enabledModelIds);

    return availableModels.filter((model) => configuredProviderIds.has(model.providerID) && (enabledModelIds.size === 0 || enabledModelIds.has(model.id)));
  }, [availableModels, chatPreferences.enabledModelIds, configuredProviders]);
  const diffDetails = useMemo(
    () => currentTranscript.flatMap((entry) => entry.details.filter((detail) => detail.kind === 'patch')),
    [currentTranscript],
  );
  const diffCount = currentDiffs.length || (currentDiffScope === 'turn'
    ? new Set(diffDetails.flatMap((detail) => detail.body.split('\n').filter(Boolean))).size
    : 0);
  const selectedAgentLabel = useMemo(
    () => availableAgents.find((agent) => agent.id === chatPreferences.mode)?.label || chatPreferences.mode,
    [availableAgents, chatPreferences.mode],
  );
  const pendingInteractions = currentPendingPermissions.length + currentPendingQuestions.length;
  const awaitingUserInput = pendingInteractions > 0;
  const displayTranscript = useMemo(() => currentTranscript.filter(isTranscriptDisplayMessage), [currentTranscript]);
  const currentActivityLabel = useMemo(() => {
    for (let index = currentTranscript.length - 1; index >= 0; index -= 1) {
      const entry = currentTranscript[index];
      if (isTranscriptDisplayMessage(entry)) {
        continue;
      }

      const label = getTranscriptActivityLabel(entry);
      if (label) {
        return label;
      }
    }

    return undefined;
  }, [currentTranscript]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) || activeSession,
    [activeSession, currentSessionId, sessions],
  );
  const contextTokens = useMemo(() => getLatestContextTokens(currentMessages) ?? 0, [currentMessages]);
  const contextModel = useMemo(
    () => availableModels.find((model) => model.providerID === selectedSession?.model?.providerID && model.modelID === selectedSession?.model?.id),
    [availableModels, selectedSession?.model?.id, selectedSession?.model?.providerID],
  );
  const visiblePromptError = promptError && (!promptError.sessionId || promptError.sessionId === currentSessionId)
    ? promptError.message
    : undefined;
  const sendErrorMessage = sendFeedback || visiblePromptError;
  const buildSendErrorDetails = useCallback(() => {
    if (!sendErrorMessage) {
      return '';
    }

    return [
      t('chat:view.sendError.title'),
      t('chat:view.sendError.error', { message: sendErrorMessage }),
      t('chat:view.sendError.time', { time: new Date(promptError?.occurredAt || Date.now()).toISOString() }),
      t('chat:view.sendError.session', { session: currentSessionId || t('chat:view.sendError.unknown') }),
      t('chat:view.sendError.server', { server: settings.serverUrl }),
      t('chat:view.sendError.model', { model: chatPreferences.modelId || t('chat:view.sendError.unknown') }),
      t('chat:view.sendError.attachments', { attachments: lastSentAttachmentsRef.current.map((attachment) => attachment.filename || attachment.mime || t('chat:view.sendError.unnamed')).join(', ') || t('chat:view.sendError.none') }),
    ].join('\n');
  }, [chatPreferences.modelId, currentSessionId, promptError?.occurredAt, sendErrorMessage, settings.serverUrl, t]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const latestAssistantEntry = useMemo(
    () => [...displayTranscript].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim()),
    [displayTranscript],
  );
  const speechInput = useSpeechInput({
    locale: chatPreferences.speechLocale,
    onResult: (transcript) => {
      if (conversationActive) {
        return;
      }
      setDraft(`${speechDraftPrefixRef.current}${transcript}`);
    },
    preferOnDevice: chatPreferences.preferOnDeviceRecognition,
  });
  const {
    error: speechInputError,
    errorAction: speechInputErrorAction,
    isAvailable: isSpeechInputAvailable,
    isListening: isSpeechInputListening,
    start: startSpeechInput,
    stop: stopSpeechInput,
  } = speechInput;
  // Only offer a recovery action when the snackbar is actually showing a
  // voice-input error, not unrelated conversation or playback feedback.
  // Dictation failures live in this component's own hook; conversation
  // failures carry their action from the provider so the two always match.
  const dictationVoiceFailure = Boolean(voiceFeedback && voiceFeedback === speechInputError);
  const voiceRecoveryAction = dictationVoiceFailure
    ? speechInputErrorAction
    : conversation.feedback
      ? conversation.feedbackAction ?? 'none'
      : 'none';

  const handleSendPrompt = useCallback(async (promptOverride?: string) => {
    const nextDraft = promptOverride ?? draftRef.current;
    const nextAttachments = attachmentsRef.current;
    const prompt = nextDraft.trim();
    if ((!prompt && nextAttachments.length === 0) || connection.status !== 'connected') {
      return;
    }

    try {
      setSendFeedback(undefined);
      lastSentAttachmentsRef.current = nextAttachments;
      const sessionId = currentSessionId || (await ensureActiveSession());
      if (!sessionId) {
        return;
      }

      setDraft('');
      setAttachments([]);

      const commandMatch = nextAttachments.length === 0 ? prompt.match(/^\/(\S+)(?:\s+([\s\S]*))?$/) : undefined;
      if (commandMatch && commands.some((command) => command.name === commandMatch[1])) {
        await executeCommand(sessionId, commandMatch[1], commandMatch[2] || '');
        return;
      }

      const sent = await sendPrompt(sessionId, prompt, nextAttachments);
      if (!sent) {
        setDraft(nextDraft);
        setAttachments(nextAttachments);
        setSendFeedback(t('chat:view.couldNotSendRetry'));
      }
    } catch (error) {
      setDraft(nextDraft);
      setAttachments(nextAttachments);
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotSend'));
    }
  }, [commands, connection.status, currentSessionId, ensureActiveSession, executeCommand, sendPrompt, t]);

  useEffect(() => {
    // ponytail: session/tab switch is the escape hatch when the transcript
    // is too short for drag-to-dismiss; one effect beats a guard per caller.
    Keyboard.dismiss();
  }, [currentSessionId, activeTab]);

  useEffect(() => {
    if (pendingInteractions > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-focus the session tab when the server needs input; no render-time equivalent.
      setActiveTab('session');
    }
  }, [pendingInteractions]);

  useEffect(() => {
    if (!copiedMessageId) {
      return;
    }

    const timer = setTimeout(() => setCopiedMessageId(undefined), 1800);
    return () => clearTimeout(timer);
  }, [copiedMessageId]);

  useEffect(() => {
    conversationActiveRef.current = conversationActive;
  }, [conversationActive]);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    voiceRecoveryContextRef.current = conversationActiveRef.current ? 'conversation' : 'dictation';

    // While conversation mode is active the provider owns the listening
    // session, including its own retry/fallback and feedback. Surfacing this
    // hook's error too would flash a false failure during the automatic
    // on-device -> network retry.
    if (conversationActiveRef.current) {
      return;
    }

    setVoiceFeedback(speechInputError);
  }, [speechInputError]);

  useEffect(
    () => () => {
      void stopSpeaking().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (running || conversationActive || !chatPreferences.autoPlayAssistantReplies) {
      return;
    }

    if (!latestAssistantEntry || latestAssistantEntry.id === lastAutoSpokenMessageIdRef.current) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const started = await speakText({
        language: chatPreferences.speechLocale,
        onDone: () => {
          if (!cancelled) setSpeakingMessageId((current) => (current === latestAssistantEntry.id ? undefined : current));
        },
        onError: () => {
          if (!cancelled) {
            setVoiceFeedback(t('chat:view.unableToPlay'));
            setSpeakingMessageId(undefined);
          }
        },
        onStart: () => {
          if (!cancelled) setSpeakingMessageId(latestAssistantEntry.id);
        },
        rate: chatPreferences.speechRate,
        text: latestAssistantEntry.text,
        voice: chatPreferences.speechVoiceId,
      });

      if (started && !cancelled) {
        lastAutoSpokenMessageIdRef.current = latestAssistantEntry.id;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatPreferences.autoPlayAssistantReplies, chatPreferences.speechLocale, chatPreferences.speechRate, chatPreferences.speechVoiceId, conversationActive, latestAssistantEntry, running, t]);

  async function handleCopyMessage(entry: TranscriptEntry) {
    const value = [entry.text.trim(), entry.error?.trim()].filter(Boolean).join('\n\n');
    if (!value) {
      return;
    }

    await Clipboard.setStringAsync(value);
    setCopiedMessageId(entry.id);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }

  async function handleToggleRecording() {
    if (conversationActive) {
      return;
    }

    if (isSpeechInputListening) {
      stopSpeechInput();
      return;
    }

    speechDraftPrefixRef.current = draft.trim() ? `${draft.trim()} ` : '';
    const started = await startSpeechInput();
    if (!started) {
      return;
    }

    void Haptics.selectionAsync().catch(() => undefined);
  }

  // Just-in-time recovery for a voice-input failure: prompt again when the OS
  // still allows it, deep-link to app settings after a denial, or restart the
  // surface the user was in.
  function handleVoiceRecovery() {
    setVoiceFeedback(undefined);
    clearConversationFeedback();

    if (voiceRecoveryAction === 'open-settings') {
      void openVoiceSettingsAsync();
      return;
    }

    if (voiceRecoveryContextRef.current === 'conversation') {
      void toggleConversationMode();
      return;
    }

    void handleToggleRecording();
  }

  async function handleSpeakEntry(entry: TranscriptEntry) {
    if (speakingMessageId === entry.id) {
      await stopSpeaking().catch(() => undefined);
      setSpeakingMessageId(undefined);
      return;
    }

    if (conversationActive) {
      setVoiceFeedback(t('chat:view.stopConversationBeforePlay'));
      return;
    }

    const started = await speakText({
      language: chatPreferences.speechLocale,
      onDone: () => {
        setSpeakingMessageId((current) => (current === entry.id ? undefined : current));
      },
      onError: () => {
        setVoiceFeedback(t('chat:view.unableToPlay'));
        setSpeakingMessageId(undefined);
      },
      onStart: () => setSpeakingMessageId(entry.id),
      rate: chatPreferences.speechRate,
      text: entry.text,
      voice: chatPreferences.speechVoiceId,
    });

    if (!started) {
      setVoiceFeedback(t('chat:view.noReadableText'));
    }
  }

  async function handleAttach() {
    try {
      const picker = await import('expo-document-picker');
      const result = await picker.getDocumentAsync({
        base64: Platform.OS === 'web',
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }
      if (result.assets.some((asset) => typeof asset.size === 'number' && asset.size > 10 * 1024 * 1024)) {
        setSendFeedback(t('chat:view.fileTooLarge'));
        return;
      }

      setSendFeedback(undefined);
      setAttachments((current) => {
        const next = [...current];

        result.assets.forEach((asset) => {
          const uri = asset.base64
            ? `data:${asset.mimeType || 'application/octet-stream'};base64,${asset.base64}`
            : asset.uri;
          if (!next.some((attachment) => attachment.uri === uri)) {
            next.push({
              uri,
              mime: asset.mimeType || 'application/octet-stream',
              filename: asset.name,
            });
          }
        });

        return next;
      });
    } catch (error) {
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotAttach'));
    }
  }

  async function handleNewSession() {
    setIsCreatingSession(true);
    try {
      const session = await createSession();
      await openSession(session.id);
      setActiveTab('session');
    } catch (error) {
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotCreateSession'));
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function handleAbort() {
    if (!currentSessionId) {
      return;
    }

    setIsStoppingSession(true);
    try {
      await abortSession(currentSessionId);
    } catch (error) {
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotStopSession'));
    } finally {
      setIsStoppingSession(false);
    }
  }

  function handleConfirmStopConversation() {
    Alert.alert(t('chat:view.stopConversationTitle'), t('chat:view.stopConversationMessage'), [
      { style: 'cancel', text: t('chat:view.keepGoing') },
      {
        style: 'destructive',
        text: t('common:actions.stop'),
        onPress: () => {
          void toggleConversationMode();
        },
      },
    ]);
  }

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: palette.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
        <ChatHeader
          activeProjectLabel={activeProject?.label}
          connectionStatus={connection.status}
          conversation={conversation}
          contextLimit={contextModel?.contextLimit}
          contextTokens={contextTokens}
          insetsTop={insets.top}
          isCreatingSession={isCreatingSession}
          onConfirmStopConversation={handleConfirmStopConversation}
          onCreateSession={() => void handleNewSession()}
          onOpenSessionMenu={() => setSessionMenuVisible(true)}
          onToggleConversationMode={() => void toggleConversationMode()}
          palette={palette}
          selectedSession={selectedSession}
          latestAssistantTurnUsage={latestAssistantTurnUsage}
          slim={slim}
          usage={currentUsage}
        />

        <View style={[styles.tabsRow, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
          <TopTab active={activeTab === 'session'} label={t('chat:view.tabSession')} onPress={() => setActiveTab('session')} slim={slim} />
          <TopTab active={activeTab === 'changes'} label={t('chat:view.tabFilesChanged', { files: diffCount })} onPress={() => setActiveTab('changes')} slim={slim} />
        </View>

        <ChatContent
          activeSession={activeSession}
          activeTab={activeTab}
          awaitingUserInput={awaitingUserInput}
          connection={connection}
          copiedMessageId={copiedMessageId}
          currentActivityLabel={currentActivityLabel}
          currentDiffs={currentDiffs}
          currentDiffScope={currentDiffScope}
          currentPendingPermissions={currentPendingPermissions}
          currentPendingQuestions={currentPendingQuestions}
          currentTodos={currentTodos}
          diffCount={diffCount}
          diffDetails={diffDetails}
          diffTurns={diffTurns}
          displayTranscript={displayTranscript}
          flatTranscript={chatPreferences.flatTranscript === true}
          slim={slim}
          transcriptFontSize={normalizeTranscriptFontSize(chatPreferences.transcriptFontSize)}
          expandedDiffId={expandedDiffId}
          isRefreshingDiffs={isRefreshingDiffs}
          isRefreshingMessages={isRefreshingMessages}
          onCopyMessage={(entry) => void handleCopyMessage(entry)}
          onExpandDiff={setExpandedDiffId}
          onRefresh={() => void refreshCurrentSession()}
          onRefreshDiffs={() => void refreshDiffs()}
          onSelectDiffScope={setDiffScope}
          onSelectDiffMessage={selectDiffMessage}
          selectedDiffMessageId={selectedDiffMessageId}
          onRejectQuestion={(requestId) => rejectQuestion(requestId).catch((error) => { setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRejectQuestion')); throw error; })}
          onReplyToPermission={(requestId, reply) => replyToPermission(requestId, reply).catch((error) => { setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotReplyPermission')); })}
          onReplyToQuestion={(requestId, answers) => replyToQuestion(requestId, answers).catch((error) => { setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotAnswerQuestion')); throw error; })}
          onForkMessage={(messageId) => {
            if (!currentSessionId) return;
            void forkSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotFork')));
          }}
          onRevertMessage={(messageId) => {
            if (!currentSessionId) return;
            if (Platform.OS === 'web') {
              if (globalThis.confirm(t('chat:view.revertConfirm'))) {
                void revertSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRevert')));
              }
              return;
            }
            Alert.alert(t('chat:view.revertTitle'), t('chat:view.revertMessage'), [
              { text: t('common:actions.cancel'), style: 'cancel' },
              { text: t('chat:view.revert'), style: 'destructive', onPress: () => void revertSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRevert'))) },
            ]);
          }}
          onUnrevert={() => currentSessionId ? void unrevertSession(currentSessionId).catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRestore'))) : undefined}
          onSendStarterPrompt={(prompt) => void handleSendPrompt(prompt)}
          onToggleSpeak={(entry) => void handleSpeakEntry(entry)}
          palette={palette}
          pendingInteractions={pendingInteractions}
          running={running}
          speakingMessageId={speakingMessageId}
          status={status}
        />

        {sendErrorMessage ? (
          <Card mode="contained" style={[styles.sendErrorCard, { backgroundColor: `${palette.danger}14` }]}>
            <Card.Content style={styles.sendErrorContent}>
              <Text variant="titleSmall" style={{ color: palette.danger }}>{t('chat:view.actionFailed')}</Text>
              <Text selectable variant="bodySmall" style={{ color: palette.text }}>{sendErrorMessage}</Text>
              <View style={styles.sendErrorActions}>
                <Button compact onPress={() => {
                  void Clipboard.setStringAsync(buildSendErrorDetails()).then(() => setCopiedMessageId('__send-error__'));
                }}>{t('chat:view.copyDetails')}</Button>
                <Button compact onPress={() => {
                  setSendFeedback(undefined);
                  clearPromptError();
                }}>{t('common:actions.dismiss')}</Button>
              </View>
            </Card.Content>
          </Card>
        ) : null}

        <ChatComposer
          attachments={attachments}
          autoApproveAvailable={serverCapabilities.configWrite}
          availableAgents={availableAgents}
          chatPreferences={chatPreferences}
          connectionStatus={connection.status}
          conversation={conversation}
          currentSessionId={currentSessionId}
          commands={commands}
          draft={draft}
          insetsBottom={insets.bottom}
          isCreatingSession={isCreatingSession}
          isSpeechInputAvailable={isSpeechInputAvailable}
          isSpeechInputListening={isSpeechInputListening}
          isStoppingSession={isStoppingSession}
          isUpdatingAutoApprove={isUpdatingAutoApprove}
          onAttach={() => void handleAttach()}
          onDraftChange={(value) => {
            setSendFeedback(undefined);
            setDraft(value);
          }}
          onCommandSelect={(command) => setDraft(`/${command} `)}
          onRemoveAttachment={(index) => {
            setSendFeedback(undefined);
            setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
          }}
          onSend={() => {
            if (!showSendAction) {
              void handleAbort();
              return;
            }

            void handleSendPrompt();
          }}
          onToggleAutoApprove={() => {
            setIsUpdatingAutoApprove(true);
            void setAutoApprove(!chatPreferences.autoApprove)
              .catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotUpdateAutoApprove')))
              .finally(() => setIsUpdatingAutoApprove(false));
          }}
          onToggleRecording={() => void handleToggleRecording()}
          palette={palette}
          selectedAgentLabel={selectedAgentLabel}
          showSendAction={showSendAction}
          slim={slim}
          updateChatPreferences={updateChatPreferences}
          visibleModels={visibleModels}
        />
      </KeyboardAvoidingView>

      <ChatLibrary visible={sessionMenuVisible} onClose={() => setSessionMenuVisible(false)} />

      <Snackbar visible={Boolean(copiedMessageId)} onDismiss={() => setCopiedMessageId(undefined)} duration={1800}>
        {copiedMessageId === '__send-error__' ? t('chat:view.errorDetailsCopied') : t('chat:view.messageCopied')}
      </Snackbar>
      <Snackbar
        visible={Boolean(conversation.feedback || voiceFeedback)}
        onDismiss={() => {
          setSendFeedback(undefined);
          setVoiceFeedback(undefined);
          clearConversationFeedback();
        }}
        duration={voiceRecoveryAction === 'none' ? 3200 : 6000}
        action={voiceRecoveryAction === 'none' ? undefined : {
          label: voiceRecoveryAction === 'open-settings' ? t('common:actions.openSettings') : t('common:actions.retry'),
          onPress: handleVoiceRecovery,
        }}>
        {conversation.feedback || voiceFeedback}
      </Snackbar>
    </>
  );
}
