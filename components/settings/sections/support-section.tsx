import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { FEEDBACK_URL, hasPlayStoreRating, PLAY_STORE_URL, SUPPORT_URL } from '@/lib/support';
import type { Palette } from './setting-rows';

function open(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

export function SupportSection({ palette }: { palette: Palette }) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:support.title')}</Text>
      <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:support.description')}</Text>
      {hasPlayStoreRating() ? (
        <Button mode="contained" icon="star" onPress={() => open(PLAY_STORE_URL)}>{t('settings:support.rate')}</Button>
      ) : null}
      <Button mode="outlined" icon="message-text-outline" onPress={() => open(FEEDBACK_URL)}>{t('settings:support.feedback')}</Button>
      <Button mode="outlined" icon="open-in-new" onPress={() => open(SUPPORT_URL)}>{t('settings:support.openSupport')}</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  title: { fontWeight: '600' },
});
