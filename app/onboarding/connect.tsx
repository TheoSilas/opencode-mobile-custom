import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, HelperText, Text } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { TextInput } from '@/components/ui/text-input';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isValidServerUrl } from '@/lib/opencode/client';
import { useConnection } from '@/providers/opencode-contexts';

export default function OnboardingConnectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { settings, switchConnection, connectSetup } = useConnection();

  // Seeded from the current settings so re-running the assistant from Settings
  // shows the live values. Failed attempts keep whatever the user typed.
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState(settings.password);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);

  async function attempt(advance: boolean) {
    const trimmedUrl = serverUrl.trim();
    if (!trimmedUrl) {
      setError(t('settings:connection.errors.serverUrl'));
      return;
    }
    if (!isValidServerUrl(trimmedUrl)) {
      setError(t('settings:connection.errors.invalidUrl'));
      return;
    }

    setError(undefined);
    setFeedback(undefined);
    const setBusy = advance ? setConnecting : setTesting;
    setBusy(true);
    try {
      // Reuses the exact profile-switch path: it persists the URL/username,
      // stores the password in SecureStore, resolves the server contract, loads
      // the workspace catalog, and reconnects.
      const result = await switchConnection({ serverUrl: trimmedUrl, username: username.trim(), password });
      if (result.status !== 'connected') {
        setError(result.message);
        return;
      }

      if (advance) {
        router.push('/onboarding/workspace');
        return;
      }
      setFeedback(t('onboarding:connect.testSuccess'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('onboarding:connect.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingStep
      step={2}
      totalSteps={6}
      title={t('onboarding:connect.title')}
      subtitle={t('onboarding:connect.subtitle')}
      testID="onboarding-connect"
      onBack={() => router.back()}
      footer={
        <>
          <Button
            mode="text"
            style={{ marginRight: 'auto' }}
            testID="onboarding-connect-skip"
            disabled={connecting || testing}
            onPress={() => router.push('/onboarding/workspace')}>
            {t('onboarding:connect.skip')}
          </Button>
          <Button
            mode="outlined"
            testID="onboarding-connect-test"
            loading={testing}
            disabled={connecting || testing}
            onPress={() => void attempt(false)}>
            {t('onboarding:connect.test')}
          </Button>
          <Button
            mode="contained"
            testID="onboarding-connect-continue"
            loading={connecting}
            disabled={connecting || testing}
            onPress={() => void attempt(true)}>
            {t('onboarding:connect.connect')}
          </Button>
        </>
      }>
      <TextInput
        mode="outlined"
        testID="onboarding-server-url"
        label={t('settings:connection.fields.serverUrl')}
        value={serverUrl}
        onChangeText={setServerUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="http://192.168.1.10:4096"
      />
      {connectSetup.enabled ? <Button testID="onboarding-pair-connect" mode="outlined" icon="qrcode-scan" onPress={() => router.push('/pair')}>{t('settings:connect.entry')}</Button> : null}
      <TextInput
        mode="outlined"
        testID="onboarding-server-username"
        label={t('settings:connection.fields.username')}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        mode="outlined"
        testID="onboarding-server-password"
        label={t('settings:connection.fields.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error ? (
        <View testID="onboarding-connect-error">
          <HelperText type="error" visible>{error}</HelperText>
        </View>
      ) : null}
      {feedback ? <HelperText type="info" visible>{feedback}</HelperText> : null}

      <Text variant="bodySmall" style={{ color: palette.muted }}>{t('onboarding:connect.hint')}</Text>
    </OnboardingStep>
  );
}
