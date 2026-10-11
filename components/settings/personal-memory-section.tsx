import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, HelperText, Switch, Text, TextInput } from 'react-native-paper';

import type { usePersonalMemory } from '@/providers/use-personal-memory';

export function PersonalMemorySection({ memory, supported }: {
  memory: ReturnType<typeof usePersonalMemory>;
  supported: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback('');
    try { await action(); } catch (error) { setFeedback(error instanceof Error ? error.message : t('settings:projectMemory.failed')); }
    finally { setBusy(false); }
  }
  const clear = () => void run(async () => {
    await memory.clear();
    setDraft('');
    setFeedback(t('settings:personalMemory.cleared'));
  });
  return <View style={styles.section}>
    <Text variant="titleMedium">{t('settings:personalMemory.title')}</Text>
    <Text variant="bodyMedium">{t('settings:personalMemory.explanation')}</Text>
    <View style={styles.toggle}>
      <Text style={{ flex: 1 }}>{t('settings:personalMemory.enabled')}</Text>
      <Switch value={memory.enabled} disabled={busy} onValueChange={(value) => void run(() => memory.setEnabled(value))} />
    </View>
    <HelperText type="info">{supported ? t('settings:personalMemory.costHint') : t('settings:personalMemory.unsupported')}</HelperText>
    {memory.extractionFailed ? <HelperText type="error">{t('settings:personalMemoryExtractionFailed')}</HelperText> : null}
    {memory.items.length ? memory.items.map((item, index) => <Text key={`${index}-${item}`} variant="bodyMedium">• {item}</Text>)
      : <Text variant="bodySmall">{t('settings:personalMemory.empty')}</Text>}
    {editing ? <>
      <TextInput multiline mode="outlined" label={t('settings:personalMemory.editor')} value={draft} onChangeText={setDraft} />
      <Button disabled={busy} mode="contained" onPress={() => void run(async () => {
        await memory.save(draft.split('\n'));
        setEditing(false);
        setFeedback(t('settings:personalMemory.saved'));
      })}>{t('settings:projectMemory.save')}</Button>
      <Button onPress={() => setEditing(false)}>{t('common:actions.cancel')}</Button>
    </> : <Button onPress={() => { setDraft(memory.items.join('\n')); setEditing(true); }}>{t('settings:personalMemory.edit')}</Button>}
    {memory.items.length > 0 ? <Button disabled={busy} onPress={() => {
      if (Platform.OS === 'web') {
        if (globalThis.confirm(t('settings:personalMemory.clearConfirm'))) clear();
      } else Alert.alert(t('settings:personalMemory.clear'), t('settings:personalMemory.clearConfirm'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('settings:personalMemory.clear'), style: 'destructive', onPress: clear },
      ]);
    }}>{t('settings:personalMemory.clear')}</Button> : null}
    {feedback ? <Text accessibilityRole="alert">{feedback}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ section: { gap: 12, padding: 16 }, toggle: { flexDirection: 'row', alignItems: 'center', minHeight: 48 } });
