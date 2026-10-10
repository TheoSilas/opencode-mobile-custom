import { Alert, Platform } from 'react-native';
import type { Dispatch, SetStateAction } from 'react';

import type { TranscriptEntry } from '@/lib/opencode/format';
import { pickedAttachment } from '@/lib/attachment-preview';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import type { ChatPreferences } from '@/providers/opencode-provider-types';

type Attachment = { uri: string; mime?: string; filename?: string };

type ChatViewActionsInput = {
  t: (key: string) => string;
  chatPreferences: ChatPreferences;
  conversationActive: boolean;
  currentSessionId?: string;
  speakingMessageId?: string;
  abortSession: (sessionId: string) => Promise<void>;
  createSession: () => Promise<{ id: string }>;
  openSession: (sessionId: string) => Promise<void>;
  toggleConversationMode: () => Promise<void>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setChangesVisible: Dispatch<SetStateAction<boolean>>;
  setSendFeedback: Dispatch<SetStateAction<string | undefined>>;
  setIsCreatingSession: Dispatch<SetStateAction<boolean>>;
  setIsStoppingSession: Dispatch<SetStateAction<boolean>>;
  setSpeakingMessageId: Dispatch<SetStateAction<string | undefined>>;
  setVoiceFeedback: Dispatch<SetStateAction<string | undefined>>;
};

export function useChatViewActions({
  t,
  chatPreferences,
  conversationActive,
  currentSessionId,
  speakingMessageId,
  abortSession,
  createSession,
  openSession,
  toggleConversationMode,
  setAttachments,
  setChangesVisible,
  setSendFeedback,
  setIsCreatingSession,
  setIsStoppingSession,
  setSpeakingMessageId,
  setVoiceFeedback,
}: ChatViewActionsInput) {
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

  async function handleAttach(source: 'photos' | 'files' = 'files') {
    try {
      if (source === 'photos') {
        const picker = await import('expo-image-picker');
        const result = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1, base64: Platform.OS === 'web' });
        if (result.canceled || !result.assets?.length) return;
        if (result.assets.some((asset) => asset.mimeType && !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(asset.mimeType))) {
          setSendFeedback(t('chat:accounts.unsupportedFormat'));
          return;
        }
        if (result.assets.some((asset) => typeof asset.fileSize === 'number' && asset.fileSize > 10 * 1024 * 1024)) {
          setSendFeedback(t('chat:view.fileTooLarge'));
          return;
        }
        setSendFeedback(undefined);
        setAttachments((current) => {
          const next = [...current];
          result.assets.forEach((asset) => {
            if (!next.some((entry) => entry.uri === asset.uri)) next.push(pickedAttachment({ uri: asset.uri, base64: asset.base64 || undefined, mimeType: asset.mimeType || 'image/jpeg', name: asset.fileName || `photo.${asset.mimeType?.split('/')[1] || 'jpg'}` }));
          });
          return next;
        });
        return;
      }
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
          const attachment = pickedAttachment(asset);
          if (!next.some((current) => current.uri === attachment.uri)) {
            next.push(attachment);
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
      setChangesVisible(false);
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

  return {
    handleSpeakEntry,
    handleAttach,
    handleNewSession,
    handleAbort,
    handleConfirmStopConversation,
  };
}
