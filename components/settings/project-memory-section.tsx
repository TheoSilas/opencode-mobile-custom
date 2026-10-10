import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, HelperText, Switch, Text, TextInput } from 'react-native-paper';

import type { useProjectMemory, ProjectHandoff } from '@/providers/use-project-memory';

const empty = { decisions: '', progress: '', tests: '', nextSteps: '' };
type Draft = Omit<ProjectHandoff, 'updatedAt'>;

export function ProjectMemorySection({ memory, projectPath }: { memory: ReturnType<typeof useProjectMemory>; projectPath?: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback('');
    try { await action(); } catch (error) { setFeedback(error instanceof Error ? error.message : t('settings:projectMemory.failed')); }
    finally { setBusy(false); }
  }
  const fields: { key: keyof Draft; label: string }[] = [
    { key: 'decisions', label: t('settings:projectMemory.decisions') },
    { key: 'progress', label: t('settings:projectMemory.progress') },
    { key: 'tests', label: t('settings:projectMemory.tests') },
    { key: 'nextSteps', label: t('settings:projectMemory.nextSteps') },
  ];
  return <View style={styles.section}>
    <Text variant="bodyMedium">{t('settings:projectMemory.explanation')}</Text>
    <Text variant="bodySmall">{projectPath || t('settings:projectMemory.noProject')}</Text>
    <View style={styles.toggle}>
      <Text style={{ flex: 1 }}>{t('settings:projectMemory.enabled')}</Text>
      <Switch value={memory.enabled} disabled={!projectPath || busy} onValueChange={(value) => void run(() => memory.setEnabled(value))} />
    </View>
    <HelperText type="info">{t('settings:projectMemory.offHint')}</HelperText>
    <Button disabled={!projectPath || busy} onPress={() => void run(async () => {
      const record = await memory.view();
      setDraft(record ? { decisions: record.decisions, progress: record.progress, tests: record.tests, nextSteps: record.nextSteps } : empty);
      setOpen(true);
    })}>{t('settings:projectMemory.viewEdit')}</Button>
    {open ? <>
      {fields.map(({ key, label }) => <TextInput key={key} label={label} value={draft[key]} multiline maxLength={2000} mode="outlined" onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))} />)}
      {memory.record ? <Text variant="bodySmall">{t('settings:projectMemory.updated')}: {new Date(memory.record.updatedAt).toLocaleString()}</Text> : null}
      <Text variant="bodySmall">{t('settings:projectMemory.testHint')}</Text>
      <Button disabled={busy} mode="contained" onPress={() => void run(async () => { await memory.save(draft); setFeedback(t('settings:projectMemory.saved')); })}>{t('settings:projectMemory.save')}</Button>
      <Button disabled={busy} onPress={() => {
        const clear = () => void run(async () => { await memory.clear(); setDraft(empty); setFeedback(t('settings:projectMemory.cleared')); });
        if (Platform.OS === 'web') {
          if (globalThis.confirm(t('settings:projectMemory.clearConfirm'))) clear();
        } else Alert.alert(t('settings:projectMemory.clear'), t('settings:projectMemory.clearConfirm'), [
          { text: t('common:actions.cancel'), style: 'cancel' },
          { text: t('settings:projectMemory.clear'), style: 'destructive', onPress: clear },
        ]);
      }}>{t('settings:projectMemory.clear')}</Button>
    </> : null}
    {feedback ? <Text accessibilityRole="alert">{feedback}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ section: { gap: 12, padding: 16 }, toggle: { flexDirection: 'row', alignItems: 'center', minHeight: 48 } });
