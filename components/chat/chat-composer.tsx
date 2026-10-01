import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Chip, IconButton, Surface, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { TextInput } from '@/components/ui/text-input';
import { ControlButton, SelectControl } from '@/components/chat/chat-controls';
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
  insetsBottom: number;
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
  onToggleAutoApprove: () => void;
  onToggleRecording: () => void;
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
  insetsBottom,
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
  palette,
  selectedAgentLabel,
  showSendAction,
  slim = false,
  updateChatPreferences,
  visibleModels,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const minInputHeight = slim ? 22 : 24;
  const maxInputHeight = slim ? 90 : 110;
  const hasComposerContent = Boolean(draft.trim()) || attachments.length > 0;
  const showOuterAction = showSendAction ? (hasComposerContent ? 'send' : 'attach') : 'stop';
  const outerActionIcon = showOuterAction === 'attach' ? 'plus' : showOuterAction;
  const outerActionDisabled =
    showOuterAction === 'attach'
      ? false
      : showOuterAction === 'send'
        ? ((!draft.trim() && attachments.length === 0) || connectionStatus !== 'connected' || isCreatingSession || isSpeechInputListening)
        : !currentSessionId || isStoppingSession;
  const innerActionIcon = hasComposerContent ? 'paperclip' : (isSpeechInputListening ? 'microphone-off' : 'microphone');
  const innerActionDisabled = hasComposerContent
    ? false
    : conversation.active || connectionStatus !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable);
  const handleOuterActionPress = showOuterAction === 'attach' ? onAttach : onSend;
  const handleInnerActionPress = hasComposerContent ? onAttach : onToggleRecording;

  const [inputHeight, setInputHeight] = useState(minInputHeight);

  return (
    <Surface
      style={[styles.composer, slim && slimStyles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insetsBottom, slim ? 8 : 12) }]}
      elevation={4}>
      <View style={[styles.controlsRow, slim && slimStyles.controlsRow]}>
        <SelectControl
          disabled={availableAgents.length === 0}
          grow
          iconName="robot-outline"
          label={selectedAgentLabel}
          onValueChange={(value) => updateChatPreferences({ mode: value })}
          options={availableAgents.map((agent) => ({ value: agent.id, label: agent.label }))}
          selectedValue={chatPreferences.mode}
          slim={slim}
          title={t('chat:composer.chooseAssistantMode')}
        />
        <ModelPicker
          disabled={visibleModels.length === 0}
          models={visibleModels}
          onSelect={(model) => {
            updateChatPreferences({ providerId: model.providerID, modelId: model.id });
          }}
          recentModelIds={chatPreferences.recentModelIds}
          selectedModelId={chatPreferences.modelId}
          slim={slim}
        />
        <SelectControl
          grow
          iconName="brain"
          label={chatPreferences.reasoning}
          onValueChange={(value) => updateChatPreferences({ reasoning: value })}
          options={REASONING_OPTIONS.map((option) => ({ value: option.id, label: t(option.labelKey) }))}
          selectedValue={chatPreferences.reasoning}
          slim={slim}
          title={t('chat:composer.chooseReasoningLevel')}
        />
        {autoApproveAvailable ? (
          <ControlButton active={chatPreferences.autoApprove} iconName={getAutoApproveIcon(chatPreferences.autoApprove)} iconOnly loading={isUpdatingAutoApprove} onPress={onToggleAutoApprove} slim={slim}>
            {chatPreferences.autoApprove ? t('chat:composer.autoApproveEnabled') : t('chat:composer.askPermission')}
          </ControlButton>
        ) : null}
      </View>

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

      <View style={styles.composerDockRow}>
        <View style={[styles.inputShell, styles.inputShellFlex, slim && slimStyles.inputShell, { borderColor: palette.border, backgroundColor: palette.background }]}>
          <View style={styles.composerRow}>
            <TextInput
               testID="chat-prompt-input"
               mode="flat"
               dense
               value={draft}
               onChangeText={onDraftChange}
               onContentSizeChange={({ nativeEvent }) => {
                 const nextHeight = Math.min(maxInputHeight, Math.max(minInputHeight, Math.ceil(nativeEvent.contentSize.height)));
                 setInputHeight((current) => (current === nextHeight ? current : nextHeight));
               }}
               editable={!isSpeechInputListening}
               multiline
               scrollEnabled={false}
               placeholder={t('chat:composer.placeholder')}
               placeholderTextColor={palette.muted}
               style={[styles.input, slim && slimStyles.input, { height: inputHeight, backgroundColor: 'transparent', color: palette.text }]}
               contentStyle={styles.inputContentCompact}
               underlineColor="transparent"
               activeUnderlineColor="transparent"
               textAlignVertical="center"
             />

            <IconButton
              testID="chat-secondary-button"
              icon={innerActionIcon}
              size={slim ? 18 : 20}
              selected={!hasComposerContent && isSpeechInputListening}
              style={styles.composerVoiceButton}
              disabled={innerActionDisabled}
              onPress={handleInnerActionPress}
            />
          </View>
        </View>

        <IconButton
          testID="chat-primary-button"
          mode="contained"
          icon={outerActionIcon}
          size={slim ? 18 : 20}
          style={[styles.composerPrimaryButton, slim && slimStyles.composerPrimaryButton]}
          containerColor={palette.tint}
          iconColor={palette.surface}
          loading={showOuterAction === 'stop' && isStoppingSession}
          disabled={outerActionDisabled}
          onPress={handleOuterActionPress}
        />
      </View>
    </Surface>
  );
}
