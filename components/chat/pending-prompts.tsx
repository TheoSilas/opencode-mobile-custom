import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { AttachmentStrip } from '@/components/chat/attachment-strip';
import type { PendingPrompt } from '@/lib/opencode/prompt-inbox';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function PendingPrompts({ prompts }: { prompts: PendingPrompt[] }) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  if (!prompts.length) return null;
  return (
    <ScrollView testID="pending-prompts" style={styles.stack} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {prompts.map((prompt) => (
        <View key={prompt.id} testID="pending-prompt" style={[styles.prompt, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
          <Text variant="labelSmall" style={{ color: palette.muted }}>
            {t(prompt.state === 'sending' ? 'chat:pendingPrompts.sending' : 'chat:pendingPrompts.waiting')}{' · '}
            {t(prompt.delivery === 'queue' ? 'settings:providers.promptDelivery.queue.label' : 'settings:providers.promptDelivery.steer.label')}
          </Text>
          {prompt.attachments.length ? <AttachmentStrip attachments={prompt.attachments} /> : null}
          {prompt.text ? <Text style={{ color: palette.text }}>{prompt.text}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stack: { maxHeight: '25%', flexGrow: 0, flexShrink: 1 },
  content: { gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  prompt: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 6 },
});
