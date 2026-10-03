import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectPanel } from '@/components/settings/connect-panel';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useConnection, useOnboarding } from '@/providers/opencode-contexts';

export default function PairScreen() {
  const params = useLocalSearchParams<{ v?: string; cp?: string; id?: string; t?: string; n?: string }>();
  const router = useRouter();
  const { connectSetup } = useConnection();
  const { isHydrated, onboardingCompleted, onboardingActive } = useOnboarding();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { acceptLink } = connectSetup;
  useEffect(() => {
    if (isHydrated && (params.v || params.cp || params.id || params.t || params.n)) {
      void acceptLink(params);
      router.replace('/pair');
    }
  }, [acceptLink, isHydrated, params, router]);
  if (!connectSetup.enabled) return null;
  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
        <ConnectPanel setup={connectSetup} onConnected={() => router.replace(!onboardingCompleted || onboardingActive ? '/onboarding/workspace' : '/(tabs)/workspace')} onClose={() => router.replace(!onboardingCompleted || onboardingActive ? '/onboarding/connect' : '/(tabs)/settings')} />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
