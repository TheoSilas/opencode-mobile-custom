import { useCameraPermissions } from 'expo-camera';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';

/**
 * Resolves camera permission before the pairing surface (and its subscription
 * sheet) render. Denial cancels pairing instead of revealing a scan-first
 * screen the user cannot use. Web never uses the camera and is passed through.
 */
export function ConnectCameraGate({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const native = Platform.OS === 'ios' || Platform.OS === 'android';
  const [permission] = useCameraPermissions({ request: native });
  useEffect(() => {
    if (native && permission && !permission.granted) onCancel();
  }, [native, onCancel, permission]);
  if (!native || permission?.granted) return <>{children}</>;
  return <View style={styles.screen}><ActivityIndicator accessibilityLabel={t('settings:connect.cameraLoading')} /></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
