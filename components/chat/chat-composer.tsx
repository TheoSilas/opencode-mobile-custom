import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, Text as NativeText, useWindowDimensions, View } from 'react-native';
import { Chip, IconButton, Surface, Text, useTheme } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { TextInput } from '@/components/ui/text-input';
import { NativeSelect } from '@/components/ui/native-select';
import { ModelPicker } from '@/components/chat/model-picker';
import { styles, slimStyles } from '@/components/chat/chat-view-styles';
import { getAutoApproveIcon, REASONING_OPTIONS } from '@/components/chat/chat-view-utils';
import type { AgentOption, ChatPreferences, ModelOption } from '@/providers/opencode-provider';
import type { Command } from '@/lib/opencode/types';

type Palette = typeof Colors.light;

type Attachment = { uri: string; mime?: string; filename?: string };

type ChatComposerProps = {
  attachments: Attachment[];
  availableAgents: AgentOption[];
  chatPreferences: ChatPreferences;
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  conversation: { active: boolean; isListening: boolean; phase: string; statusLabel?: string };
  draft: string;
  isCreatingSession: boolean;
  isSpeechInputAvailable: boolean;
  isSpeechInputListening: boolean;
  isStoppingSession: boolean;
  isUpdatingAutoApprove: boolean;
  autoApproveAvailable?: boolean;
  onAttach: () => void;
  onDraftChange: (value: string) => void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => void;
  onToggleAutoApprove: () => Promise<boolean>;
  onToggleRecording: () => void;
  onToggleConversationMode: () => void;
  palette: Palette;
  selectedAgentLabel: string;
  showSendAction: boolean;
  slim?: boolean;
  currentSessionId?: string;
  visibleModels: ModelOption[];
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  commands: Command[];
  onCommandSelect: (command: string) => void;
};

export function ChatComposer({
  attachments,
  availableAgents,
  chatPreferences,
  connectionStatus,
  conversation,
  currentSessionId,
  commands,
  draft,
  isCreatingSession,
  isSpeechInputAvailable,
  isSpeechInputListening,
  isStoppingSession,
  isUpdatingAutoApprove,
  autoApproveAvailable = true,
  onAttach,
  onCommandSelect,
  onDraftChange,
  onRemoveAttachment,
  onSend,
  onToggleAutoApprove,
  onToggleRecording,
  onToggleConversationMode,
  palette,
  selectedAgentLabel,
  showSendAction,
  slim = false,
  updateChatPreferences,
  visibleModels,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const { fonts } = useTheme();
  const { fontScale } = useWindowDimensions();
  const minInputHeight = slim ? 36 : 44;
  const maxInputHeight = slim ? 90 : 110;
  const hasComposerContent = Boolean(draft.trim()) || attachments.length > 0;
  const primaryAction = !showSendAction ? 'stop' : hasComposerContent ? 'send' : 'voice';
  const primaryDisabled = primaryAction === 'stop'
    ? !currentSessionId || isStoppingSession
    : primaryAction === 'send'
      ? connectionStatus !== 'connected' || isCreatingSession || isSpeechInputListening
      : connectionStatus !== 'connected' || !isSpeechInputAvailable;
  const reasoningLabel = t(REASONING_OPTIONS.find((option) => option.id === chatPreferences.reasoning)?.labelKey || 'chat:composer.chooseReasoningLevel');

  const [inputHeight, setInputHeight] = useState(minInputHeight);
  const displayedInputHeight = draft ? Math.min(maxInputHeight, Math.max(minInputHeight, inputHeight)) : minInputHeight;
  const inputTextStyle = [styles.composerTextArea, slim && { fontSize: 15 }];
  function updateInputHeight(height: number) {
    const nextHeight = Math.min(maxInputHeight, Math.max(minInputHeight, Math.ceil(height)));
    setInputHeight((current) => (current === nextHeight ? current : nextHeight));
  }

  const modelPicker = (
    <ModelPicker
      compact
      reasoningLabel={reasoningLabel}
      reasoning={chatPreferences.reasoning}
      onReasoningChange={(reasoning) => updateChatPreferences({ reasoning })}
      disabled={visibleModels.length === 0}
      models={visibleModels}
      onSelect={(model) => updateChatPreferences({ providerId: model.providerID, modelId: model.id })}
      recentModelIds={chatPreferences.recentModelIds}
      selectedModelId={chatPreferences.modelId}
      slim={slim}
    />
  );

  return (
    <Surface
      style={[styles.composer, slim && slimStyles.composer, { backgroundColor: palette.background, borderTopWidth: 0 }]}
      elevation={0}>
      {conversation.active ? (
        <View style={[styles.conversationBanner, { backgroundColor: `${palette.tint}10`, borderColor: `${palette.tint}28` }]}>
          <View style={styles.conversationBannerHeader}>
            <Text variant="labelLarge" style={{ color: palette.text }}>{t('chat:composer.conversationMode')}</Text>
            <Chip compact icon={conversation.phase === 'speaking' ? 'volume-high' : 'microphone'}>{conversation.statusLabel || t('common:labels.active')}</Chip>
          </View>
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            {t('chat:composer.conversationHint')}
          </Text>
        </View>
      ) : null}

      {attachments.length > 0 ? (
        <View style={styles.attachmentRow}>
          {attachments.map((att, idx) => (
            <View key={`${att.uri}-${idx}`} style={[styles.attachmentChip, { backgroundColor: palette.background }]}>
              <Text numberOfLines={1} variant="labelLarge" style={[styles.attachmentLabel, { color: palette.text }]}>
                {att.filename || att.uri}
              </Text>
              <IconButton
                accessibilityLabel={t('chat:composer.removeAttachment', { name: att.filename || t('chat:composer.attachment') })}
                icon="close"
                size={18}
                style={styles.attachmentRemoveButton}
                onPress={() => onRemoveAttachment(idx)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {draft.startsWith('/') && !draft.includes(' ') && commands.length > 0 ? (
        <View style={styles.attachmentRow}>
          {commands.filter((command) => command.name.startsWith(draft.slice(1))).slice(0, 6).map((command) => (
            <Chip key={command.name} compact mode="outlined" onPress={() => onCommandSelect(command.name)}>
              /{command.name}
            </Chip>
          ))}
        </View>
      ) : null}

      {isSpeechInputListening || conversation.isListening ? (
        <View style={styles.voiceStatusRow}>
          <Chip compact icon="microphone" style={[styles.voiceStatusChip, { backgroundColor: `${palette.tint}14` }]}>
            {conversation.active ? t('chat:composer.conversationActive') : t('chat:composer.listening')}
          </Chip>
        </View>
      ) : null}

      <View testID="chat-composer-card" style={[styles.composerCard, slim && { borderRadius: 22 }, { backgroundColor: palette.surfaceAlt }]}>
        {Platform.OS === 'ios' ? (
          // iOS Fabric may not emit content-size changes for fixed-height inputs.
          <NativeText
            testID="chat-prompt-measurement"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            maxFontSizeMultiplier={1.5}
            onLayout={({ nativeEvent }) => updateInputHeight(nativeEvent.layout.height)}
            style={[
              fonts.bodyLarge,
              { fontWeight: undefined, lineHeight: undefined },
              inputTextStyle,
              styles.inputContentCompact,
              // Match the card padding and input margins without affecting layout.
              { position: 'absolute', top: 8, left: 8, right: 8, opacity: 0 },
            ]}>
            {`${draft}\u200b`}
          </NativeText>
        ) : null}
        <TextInput
          testID="chat-prompt-input"
          mode="flat"
          dense
          value={draft}
          onChangeText={onDraftChange}
          onContentSizeChange={Platform.OS === 'ios' ? undefined : ({ nativeEvent }) => updateInputHeight(nativeEvent.contentSize.height)}
          editable={!isSpeechInputListening}
          multiline
          scrollEnabled={displayedInputHeight >= maxInputHeight}
          placeholder={t('chat:composer.placeholder')}
          placeholderTextColor={palette.muted}
          style={[inputTextStyle, { height: displayedInputHeight, color: palette.text }]}
          contentStyle={styles.inputContentCompact}
          underlineColor="transparent"
          activeUnderlineColor="transparent"
          textAlignVertical="top"
        />
        {fontScale > 1.3 ? <View>{modelPicker}</View> : null}
        <View style={styles.composerToolbar}>
          <IconButton
            testID="chat-attach-button"
            accessibilityLabel={t('chat:composer.attachFiles')}
            icon="plus"
            size={24}
            iconColor={palette.text}
            containerColor="transparent"
            style={styles.composerActionButton}
            onPress={onAttach}
          />
          {autoApproveAvailable ? (
            <IconButton
              testID="chat-approve-button"
              accessibilityLabel={`${t('chat:composer.approvals')}: ${chatPreferences.autoApprove ? t('chat:composer.autoApproveEnabled') : t('chat:composer.askPermission')}`}
              accessibilityState={{ checked: chatPreferences.autoApprove }}
              icon={getAutoApproveIcon(chatPreferences.autoApprove)}
              size={22}
              iconColor={chatPreferences.autoApprove ? palette.warning : palette.text}
              containerColor="transparent"
              style={styles.composerActionButton}
              disabled={isUpdatingAutoApprove}
              loading={isUpdatingAutoApprove}
              onPress={() => { void onToggleAutoApprove(); }}
            />
          ) : null}
          <NativeSelect
            disabled={availableAgents.length === 0}
            options={availableAgents.map((agent) => ({ value: agent.id, label: agent.label }))}
            selectedValue={chatPreferences.mode}
            onValueChange={(mode) => updateChatPreferences({ mode })}
            title={t('chat:composer.chooseAssistantMode')}
            renderTrigger={({ disabled, open }) => (
              <IconButton
                testID="chat-agent-button"
                accessibilityLabel={`${t('chat:composer.agent')}: ${selectedAgentLabel}`}
                icon={chatPreferences.mode === 'build' ? 'hammer-wrench' : chatPreferences.mode === 'plan' ? 'clipboard-text-outline' : 'robot-outline'}
                size={22}
                iconColor={palette.text}
                containerColor="transparent"
                style={styles.composerActionButton}
                disabled={disabled}
                onPress={() => { Keyboard.dismiss(); open(); }}
              />
            )}
          />
          <View style={styles.composerModelSummary}>
            {fontScale <= 1.3 ? modelPicker : null}
          </View>
          <IconButton
            testID="chat-secondary-button"
            accessibilityLabel={t(isSpeechInputListening ? 'chat:composer.stopDictation' : 'chat:composer.startDictation')}
            icon={isSpeechInputListening ? 'microphone-off' : 'microphone-outline'}
            size={24}
            iconColor={palette.muted}
            containerColor="transparent"
            style={styles.composerActionButton}
            disabled={conversation.active || connectionStatus !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable)}
            onPress={onToggleRecording}
          />
          <IconButton
            testID="chat-primary-button"
            accessibilityLabel={t(primaryAction === 'voice' ? (conversation.active ? 'chat:header.stopConversationMode' : 'chat:header.startConversationMode') : primaryAction === 'send' ? 'chat:composer.sendTask' : 'chat:composer.stopTask')}
            mode="contained"
            icon={primaryAction === 'voice' ? 'waveform' : primaryAction === 'send' ? 'arrow-up' : 'stop'}
            size={22}
            style={styles.composerPrimaryButton}
            containerColor={palette.text}
            iconColor={palette.surfaceAlt}
            loading={primaryAction === 'stop' && isStoppingSession}
            disabled={primaryDisabled}
            onPress={primaryAction === 'voice' ? onToggleConversationMode : onSend}
          />
        </View>
      </View>
    </Surface>
  );
}
