import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';

export function OverlaySheet({ visible, title, onClose, children, headerAction, testID, fitContent = false, scrollable = true }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  headerAction?: ReactNode;
  testID?: string;
  fitContent?: boolean;
  scrollable?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  // Android back dismisses the open sheet instead of navigating the screen behind it.
  useDismissOnBack(visible, onClose);
  if (!visible) return null;

  return (
    <Portal>
      <View style={styles.overlay} testID={testID}>
        <Pressable accessibilityLabel={t('common:actions.closeWithName', { title })} onPress={onClose} style={StyleSheet.absoluteFill}>
          <View style={styles.backdrop} />
        </Pressable>
        <View testID={fitContent ? `${testID}-sheet` : undefined} accessibilityLabel={title} accessibilityViewIsModal style={[styles.sheet, fitContent ? { maxHeight: height - 64 - insets.top } : { top: 64 + insets.top }, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={[styles.header, { borderBottomColor: palette.border }]}>
            <Text variant="titleMedium" style={{ color: palette.text }}>{title}</Text>
            <View style={styles.headerActions}>
              {headerAction}
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
                <Text style={{ color: palette.tint }}>{t('common:actions.close')}</Text>
              </Pressable>
            </View>
          </View>
          {scrollable ? <ScrollView keyboardShouldPersistTaps="handled" style={fitContent ? styles.fitContentScroll : undefined} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {children}
          </ScrollView> : <View style={[styles.content, { flex: 1, minHeight: 0, paddingBottom: Math.max(insets.bottom, 24) }]}>{children}</View>}
        </View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  header: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderBottomWidth: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  closeButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  fitContentScroll: { flexGrow: 0, flexShrink: 1 },
  content: { padding: 12, gap: 8 },
});
