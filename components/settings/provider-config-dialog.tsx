import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Chip, HelperText, RadioButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextInput } from '@/components/ui/text-input';

import { Colors } from '@/constants/theme';
import type { ProviderAuthMethod } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

type ProviderConfigDialogProps = {
  authValues: Record<string, string>;
  effectiveAuthMethods: ProviderAuthMethod[];
  isConfiguringProvider: boolean;
  onAuthValueChange: (key: string, value: string) => void;
  onDismiss: () => void;
  onMethodChange: (index: number) => void;
  onSubmit: () => void;
  palette: Palette;
  providerDialogError?: string;
  selectedMethod?: ProviderAuthMethod;
  selectedMethodIndex: number;
  selectedProviderDescription?: string;
  selectedProviderLabel: string;
  visiblePrompts: NonNullable<ProviderAuthMethod['prompts']>;
};

export function ProviderConfigDialog({
  authValues,
  effectiveAuthMethods,
  isConfiguringProvider,
  onAuthValueChange,
  onDismiss,
  onMethodChange,
  onSubmit,
  palette,
  providerDialogError,
  selectedMethod,
  selectedMethodIndex,
  selectedProviderDescription,
  selectedProviderLabel,
  visiblePrompts,
}: ProviderConfigDialogProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onDismiss}>
      <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
        <Appbar.BackAction accessibilityLabel={t('settings:providers.cancelSetup')} onPress={onDismiss} />
        <Appbar.Content title={t('settings:providers.configureProvider', { provider: selectedProviderLabel })} />
      </Appbar.Header>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
        {selectedProviderDescription ? (
          <Text variant="bodyMedium" style={{ color: palette.muted }}>
            {selectedProviderDescription}
          </Text>
        ) : null}
        {effectiveAuthMethods.length > 1 ? (
          <RadioButton.Group onValueChange={(value) => onMethodChange(Number(value))} value={String(selectedMethodIndex)}>
            {effectiveAuthMethods.map((method, index) => (
              <View key={`${method.label}-${index}`} style={styles.authMethodRow}>
                <RadioButton value={String(index)} />
                <Text style={{ color: palette.text }}>{method.label}</Text>
              </View>
            ))}
          </RadioButton.Group>
        ) : null}

        {visiblePrompts.map((prompt: NonNullable<ProviderAuthMethod['prompts']>[number]) =>
          prompt.type === 'select' ? (
            <View key={prompt.key} style={styles.promptGroup}>
              <Text variant="labelLarge" style={{ color: palette.text }}>
                {prompt.message}
              </Text>
              <View style={styles.chipWrap}>
                {(prompt.options || []).map((option: NonNullable<typeof prompt.options>[number]) => (
                  <Chip
                    key={option.value}
                    selected={authValues[prompt.key] === option.value}
                    onPress={() => onAuthValueChange(prompt.key, option.value)}>
                    {option.label}
                  </Chip>
                ))}
              </View>
            </View>
          ) : (
            <TextInput
              key={prompt.key}
              mode="outlined"
              label={prompt.message}
              placeholder={prompt.placeholder}
              value={authValues[prompt.key] || ''}
              onChangeText={(value) => onAuthValueChange(prompt.key, value)}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={/token|key|secret|password/i.test(prompt.key)}
            />
          ),
        )}

        {selectedMethod?.type === 'oauth' ? (
          <HelperText type="info">{t('settings:providers.oauthHint')}</HelperText>
        ) : null}
        {!selectedMethod && effectiveAuthMethods.length === 0 ? (
          <HelperText type="error">{t('settings:providers.setupUnavailable')}</HelperText>
        ) : null}
        {providerDialogError ? <HelperText type="error">{providerDialogError}</HelperText> : null}
      </ScrollView>
      <View style={[styles.actions, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Button onPress={onDismiss}>{t('common:actions.cancel')}</Button>
        <Button mode="contained" testID="settings-provider-save-button" disabled={!selectedMethod} loading={isConfiguringProvider} onPress={onSubmit}>
          {selectedMethod?.type === 'oauth' ? t('settings:providers.continue') : t('common:actions.save')}
        </Button>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dialogContent: { gap: 14, padding: 16 },
  actions: { borderTopWidth: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  authMethodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptGroup: { gap: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
