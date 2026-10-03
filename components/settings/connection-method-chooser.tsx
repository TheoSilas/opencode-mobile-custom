import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { List, Text } from 'react-native-paper';

import { useConnection } from '@/providers/opencode-contexts';

export function ConnectionMethodChooser({ onPair, onManual }: { onPair: () => void; onManual: () => void }) {
  const { t } = useTranslation();
  const { connectSetup } = useConnection();
  return <View testID="connection-method-chooser" style={{ gap: 16 }}>
    <List.Item testID="connection-method-connect" title={t('settings:connect.entry')} description={t('settings:connect.scanHint')} left={(props) => <List.Icon {...props} icon="qrcode-scan" />} right={(props) => <List.Icon {...props} icon="chevron-right" />} onPress={onPair} disabled={!connectSetup.enabled} accessibilityState={{ disabled: !connectSetup.enabled }} />
    {!connectSetup.enabled ? <Text variant="bodySmall">{t('settings:connect.nativeOnly')}</Text> : null}
    <List.Item testID="connection-method-manual" title={t('settings:connect.manual')} description={t('settings:connect.manualHint')} left={(props) => <List.Icon {...props} icon="server" />} right={(props) => <List.Icon {...props} icon="chevron-right" />} onPress={onManual} />
  </View>;
}
