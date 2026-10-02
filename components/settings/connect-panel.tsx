import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AppState, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import type { ConnectSetup } from '@/providers/use-connect-state';

function ConnectScanner({ onScan, onClose }: { onScan: (link: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraError, setCameraError] = useState(false);
  const [ready, setReady] = useState(false);
  const camera = useRef<CameraView>(null);
  const scanned = useRef(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state !== 'active') setReady(false);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!permission?.granted || !active || ready || cameraError) return;
    // Some devices (including iOS Simulator) never emit a mount error when
    // no camera is available. Keep the deep-link recovery path reachable.
    const timer = setTimeout(() => setCameraError(true), 15_000);
    return () => clearTimeout(timer);
  }, [active, cameraError, permission?.granted, ready]);
  return (
    <View style={styles.section}>
      {!permission ? <ActivityIndicator accessibilityLabel={t('settings:connect.cameraLoading')} /> : !permission.granted ? (
        <>
          <Text>{t('settings:connect.cameraPermission')}</Text>
          <Button onPress={() => permission.canAskAgain ? void requestPermission() : void Linking.openSettings()}>{permission.canAskAgain ? t('settings:connect.allowCamera') : t('settings:connect.openSettings')}</Button>
        </>
      ) : cameraError ? <>
        <HelperText testID="connect-camera-error" type="error">{t('settings:connect.cameraUnavailable')}</HelperText>
        <Button onPress={() => { setReady(false); setCameraError(false); }}>{t('common:actions.retry')}</Button>
      </> : active ? (
        <View style={styles.camera}>
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onCameraReady={() => {
            if (Platform.OS !== 'ios') { setReady(true); return; }
            // iOS can report ready even without a capture device.
            void camera.current?.getAvailableLensesAsync().then((lenses) => {
              setCameraError(lenses.length === 0);
              setReady(lenses.length > 0);
            }).catch(() => setCameraError(true));
          }} onMountError={() => setCameraError(true)} onBarcodeScanned={({ data }) => { if (!scanned.current) { scanned.current = true; onScan(data); } }} />
          {!ready ? <ActivityIndicator accessibilityLabel={t('settings:connect.cameraLoading')} /> : null}
        </View>
      ) : null}
      <Button onPress={onClose}>{t('common:actions.cancel')}</Button>
    </View>
  );
}

export function ConnectPanel({ setup, onConnected, onClose }: { setup: ConnectSetup; onConnected: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [link, setLink] = useState('');
  const [scanning, setScanning] = useState(false);
  const focused = useIsFocused();
  const runConnect = (action: Promise<boolean>) => { void action.then((ok) => { if (ok) onConnected(); }); };
  function confirm(title: string, message: string, action: () => void) {
    if (Platform.OS === 'web') { if (globalThis.confirm(message)) action(); return; }
    Alert.alert(title, message, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: title, style: 'destructive', onPress: action },
    ]);
  }
  return (
    <View testID="connect-panel" style={styles.section}>
      <Text variant="titleLarge">{t('settings:connect.title')}</Text>
      <Text>{t('settings:connect.developmentOnly')}</Text>
      <Text variant="titleMedium">{t('settings:connect.controlPlane')}</Text>
      <Text>{setup.controlPlaneUrl}</Text>
      {!setup.hasToken ? <HelperText testID="connect-token-required" type="info">{t('settings:connect.tokenRequired')}</HelperText> : null}
      {scanning && focused ? <ConnectScanner onScan={(value) => { setScanning(false); setup.acceptLink(value); }} onClose={() => setScanning(false)} /> : (
        <>
          {Platform.OS !== 'web' ? <Button testID="connect-scan-qr" mode="outlined" icon="qrcode-scan" disabled={setup.busy || setup.phase === 'saving'} onPress={() => setScanning(true)}>{t('settings:connect.scan')}</Button> : null}
          <TextInput testID="connect-pairing-link" label={t('settings:connect.pairingLink')} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} disabled={setup.busy} />
          <Button testID="connect-open-link" disabled={setup.busy || !link.trim()} onPress={() => { setup.acceptLink(link); setLink(''); }}>{t('settings:connect.openLink')}</Button>
        </>
      )}
      {setup.pairing ? <>
        <Text testID="connect-machine-name" variant="titleMedium">{setup.pairing.machineName}</Text>
        <Text>{setup.pairing.controlPlaneUrl}</Text>
        {!setup.savedProfile ? <Button testID="connect-claim" mode="contained" loading={setup.busy} disabled={setup.busy || !setup.hasToken} onPress={() => runConnect(setup.claim())}>{setup.phase === 'saving' ? t('settings:connect.retrySaving') : t('settings:connect.claim')}</Button> : null}
      </> : null}
      {setup.busy ? <Text testID="connect-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.savedProfile ? <>
        <Text>{t('settings:connect.savedConnection', { name: setup.savedProfile.name })}</Text>
        <Button testID="connect-retry-connection" mode="outlined" disabled={setup.busy} onPress={() => runConnect(setup.connectProfile(setup.savedProfile!))}>{t('common:actions.reconnect')}</Button>
      </> : null}
      <Text variant="titleMedium">{t('settings:connect.machines')}</Text>
      <Button testID="connect-refresh-machines" mode="outlined" disabled={setup.busy || !setup.hasToken} onPress={() => { void setup.refreshMachines(); }}>{t('settings:connect.refreshMachines')}</Button>
      {setup.machines?.length === 0 ? <Text testID="connect-no-machines">{t('settings:connect.noMachines')}</Text> : null}
      {setup.machines?.map((machine) => {
        const profile = setup.profiles.find((item) => item.connect?.controlPlaneUrl === setup.controlPlaneUrl && item.connect.machineId === machine.id);
        return <View key={machine.id} testID={`connect-machine-${machine.id}`} style={styles.machine}>
          <Text variant="titleMedium">{machine.name}</Text><Text>{machine.public_url}</Text>
          {profile && setup.usableProfileIds.includes(profile.id) ? <Button disabled={setup.busy} onPress={() => runConnect(setup.connectProfile(profile))}>{t('common:actions.connect')}</Button> : <Text>{t('settings:connect.pairRequired')}</Text>}
          <Button testID={`connect-revoke-${machine.id}`} disabled={setup.busy} onPress={() => confirm(t('settings:connect.revoke'), t('settings:connect.revokeConfirm'), () => { void setup.revokeMachine(machine.id); })}>{t('settings:connect.revoke')}</Button>
        </View>;
      })}
      {setup.profiles.filter((profile) => profile.connect?.controlPlaneUrl === setup.controlPlaneUrl).map((profile) => <View key={profile.id} style={styles.machine}>
        <Text>{profile.name}</Text>
        <Text>{t('settings:connect.expiresAt', { date: new Date(profile.connect!.expiresAt).toLocaleString() })}</Text>
        <Button disabled={setup.busy} onPress={() => confirm(t('settings:connect.forget'), t('settings:connect.forgetConfirm'), () => { void setup.forgetProfile(profile); })}>{t('settings:connect.forget')}</Button>
      </View>)}
      <Button disabled={setup.busy} onPress={onClose}>{t('common:actions.close')}</Button>
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: 12 }, camera: { height: 280, justifyContent: 'center' }, machine: { gap: 6, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#888' } });
