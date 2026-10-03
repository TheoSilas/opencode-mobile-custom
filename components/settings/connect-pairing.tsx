import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, FAB, HelperText, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionSetupForm } from '@/components/settings/connection-setup-form';
import { ConnectScanner } from '@/components/settings/connect-scanner';
import { ConnectSubscription } from '@/components/settings/connect-subscription';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { TextInput } from '@/components/ui/text-input';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ConnectSetup } from '@/providers/use-connect-state';

export function ConnectEntry(props: { setup: ConnectSetup; onConnected: () => void; onClose: () => void; onManage: () => void }) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  if (!choosing) return <ConnectPairing {...props} onClose={() => setChoosing(true)} />;
  return <View style={[styles.screen, { backgroundColor: palette.background }]}>
    <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
      <Appbar.BackAction disabled={busy} accessibilityLabel={t('common:actions.back')} onPress={props.onClose} />
      <Appbar.Content title={t('settings:connection.addConnection')} />
    </Appbar.Header>
    <View style={{ padding: 20 }}><ConnectionSetupForm onBusyChange={setBusy} onPair={() => setChoosing(false)} onConnected={props.onConnected} /></View>
  </View>;
}

export function ConnectPairing({ setup, onConnected, onClose, onManage }: { setup: ConnectSetup; onConnected: () => void; onClose: () => void; onManage: () => void }) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [sheet, setSheet] = useState<'control' | 'link'>();
  const [draft, setDraft] = useState(setup.controlPlaneUrl);
  const [link, setLink] = useState('');
  const [scanPending, setScanPending] = useState(false);
  const connected = useRef(false);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (setup.phase === 'paired' && !setup.error && !connected.current) { connected.current = true; onConnected(); }
  }, [onConnected, setup.error, setup.phase]);
  const pending = setup.busy || ['purchasing', 'pending'].includes(setup.phase);
  const subscription = setup.initialization === 'ready' && !setup.entitled;
  const canScan = setup.initialization === 'ready' && setup.entitled && !pending && !sheet && !setup.error && !scanPending;
  function close() {
    if (pending || scanPending) return;
    void setup.cancelPairing().then((ok) => { if (ok) onClose(); });
  }
  async function scan(value: string) {
    setScanPending(true);
    try { await setup.pairLink(value); } finally { setScanPending(false); }
  }
  return <KeyboardAvoidingView testID="connect-panel" style={[styles.screen, { backgroundColor: palette.background }]} behavior="padding">
    {canScan && focused && active && Platform.OS !== 'web' ? <View style={StyleSheet.absoluteFill}><ConnectScanner onScan={(value) => void scan(value)} /></View> : null}
    <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
      <Appbar.BackAction disabled={pending || scanPending} accessibilityLabel={t('common:actions.back')} onPress={close} />
      <Appbar.Content title={t('settings:connect.entry')} />
    </Appbar.Header>
    <View pointerEvents="box-none" style={styles.body}>
      <Text style={[styles.instruction, { backgroundColor: palette.surface, color: palette.text }]}>{t('settings:connect.scanHint')}</Text>
      {setup.entitled ? <Text testID="connect-subscription-active" style={[styles.instruction, { backgroundColor: palette.surface, color: palette.text }]}>{t('settings:connect.subscriptionActive')}</Text> : null}
      {pending || scanPending || setup.initialization === 'loading' ? <View style={[styles.progress, { backgroundColor: palette.surface }]}><ActivityIndicator /><Text testID="connect-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text></View> : null}
      {setup.entitled ? <Button testID="connect-manage" disabled={pending} onPress={onManage}>{t('settings:connect.machines')}</Button> : null}
      <View style={styles.bottom}>
        <Button mode="contained-tonal" testID="connect-link-options" disabled={pending || scanPending} onPress={() => setSheet('link')}>{t('settings:connect.openLink')}</Button>
        <FAB testID="connect-settings" icon="cog-outline" accessibilityLabel={t('settings:connect.controlPlane')} onPress={() => { setDraft(setup.controlPlaneUrl); setSheet('control'); }} />
      </View>
    </View>
    <OverlaySheet visible={subscription && !sheet} title={t('settings:connect.title')} onClose={close} fitContent testID="connect-subscription-sheet">
      <ConnectSubscription setup={setup} />
      {setup.busy ? <Text testID="connect-subscription-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}
      <Button testID="connect-subscription-link" disabled={pending} onPress={() => setSheet('link')}>{t('settings:connect.openLink')}</Button>
      <Button testID="connect-subscription-settings" onPress={() => { setDraft(setup.controlPlaneUrl); setSheet('control'); }}>{t('settings:connect.controlPlane')}</Button>
    </OverlaySheet>
    <OverlaySheet visible={sheet === 'control'} title={t('settings:connect.controlPlane')} onClose={() => setSheet(undefined)} fitContent testID="connect-control-sheet">
      <TextInput testID="connect-control-plane" label={t('settings:connect.controlPlane')} value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url" disabled={!setup.canChangeControlPlane} />
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      <Button testID="connect-save-control-plane" mode="contained" disabled={!setup.canChangeControlPlane || !draft.trim() || draft === setup.controlPlaneUrl} onPress={() => { const saved = setup.selectControlPlane(draft); if (saved) { setDraft(saved); setSheet(undefined); } }}>{t('common:actions.save')}</Button>
      <Button onPress={() => setSheet(undefined)}>{t('common:actions.cancel')}</Button>
    </OverlaySheet>
    <OverlaySheet visible={sheet === 'link'} title={t('settings:connect.openLink')} onClose={() => setSheet(undefined)} fitContent testID="connect-link-sheet">
      <TextInput testID="connect-pairing-link" label={t('settings:connect.pairingLink')} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} disabled={pending} />
      <Button testID="connect-open-link" disabled={pending || !link.trim()} onPress={() => { setSheet(undefined); void scan(link); setLink(''); }}>{t('settings:connect.openLink')}</Button>
    </OverlaySheet>
    <OverlaySheet visible={!sheet && !subscription && Boolean(setup.error || setup.notice)} title={t('settings:connect.title')} onClose={() => { setup.dismissError(); }} fitContent testID="connect-error-sheet">
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}
      <Button testID="connect-error-settings" onPress={() => { setDraft(setup.controlPlaneUrl); setSheet('control'); }}>{t('settings:connect.controlPlane')}</Button>
      {setup.savedProfile ? <Button testID="connect-retry-connection" disabled={setup.busy} onPress={() => void setup.connectProfile(setup.savedProfile!)}>{t('common:actions.reconnect')}</Button> : null}
      <Button disabled={pending} onPress={() => { setup.dismissError(); setSheet('link'); }}>{t('settings:connect.openLink')}</Button>
    </OverlaySheet>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, body: { flex: 1, padding: 20 },
  instruction: { padding: 12, borderRadius: 12, alignSelf: 'center', marginBottom: 8 },
  progress: { padding: 20, borderRadius: 12, gap: 12, alignItems: 'center', marginTop: 24 },
  bottom: { marginTop: 'auto', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingBottom: 12 },
});
