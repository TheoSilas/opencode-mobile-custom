import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { ProviderConfigDialog, type ProviderOAuthStage, type ProviderSetupStep } from '@/components/settings/provider-config-dialog';
import { getProviderCopy, supportsGenericApiKey } from '@/components/settings/settings-utils';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ServerContract } from '@/lib/opencode/client';
import { parseProviderOAuthRedirect } from '@/lib/opencode/oauth';
import { useCapabilities, useConnection } from '@/providers/opencode-contexts';
import type { ProviderAuthMethod, ProviderAuthValues } from '@/providers/opencode-provider';

type ProviderFeedback = { type: 'success' | 'info' | 'error'; message: string };

function initialAuthValues(method?: ProviderAuthMethod): ProviderAuthValues {
  const values: ProviderAuthValues = {};
  method?.prompts?.forEach((prompt) => {
    if (prompt.type === 'select' && prompt.options?.length) {
      values[prompt.key] = typeof prompt.defaultValue === 'string' ? prompt.defaultValue : prompt.options[0].value;
    } else if (prompt.type === 'multiselect') {
      values[prompt.key] = Array.isArray(prompt.defaultValue) ? prompt.defaultValue : [];
    } else if (prompt.type === 'boolean') {
      values[prompt.key] = prompt.defaultValue === true;
    } else if (prompt.defaultValue !== undefined) {
      values[prompt.key] = prompt.defaultValue;
    }
  });
  return values;
}

// Ensure API-key methods always expose a credential field, then prepend it to
// any method-specific form fields.
function ensureApiKeyPrompt(method: ProviderAuthMethod, t: TFunction): ProviderAuthMethod {
  if (method.type !== 'api') return method;
  const hasCredentialPrompt = method.prompts?.some((prompt) => prompt.key === 'key' || prompt.key === 'token');
  if (hasCredentialPrompt) return method;
  return {
    ...method,
    prompts: [
      { type: 'text', key: 'key', message: t('settings:providers.apiKey'), placeholder: t('settings:providers.pasteApiKey') },
      ...(method.prompts ?? []),
    ],
  };
}

// The methods a provider actually offers for login: server metadata plus the V1
// generic API-key fallback for known key providers.
export function buildEffectiveMethods(
  methods: ProviderAuthMethod[],
  providerId: string | undefined,
  contract: ServerContract,
  t: TFunction,
): ProviderAuthMethod[] {
  const list = [...methods];
  if (contract !== 'v2' && supportsGenericApiKey(providerId) && !list.some((method) => method.type === 'api')) {
    list.push({ type: 'api', label: t('settings:providers.apiKey') });
  }
  return list.map((method) => ensureApiKeyPrompt(method, t));
}

/**
 * Provider credential configuration state machine shared by Settings and the
 * onboarding assistant. It owns only dialog/UI state; provider requests go
 * through the provider context (`setProviderAuth`, `startProviderOAuth`, ...).
 *
 * The flow is two full-screen steps: pick a login method, then configure it
 * (key form, automatic OAuth wait, or a pairing/authorization-code step).
 */
export function useProviderConfiguration() {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { availableProviders, providerAuthMethodsById, providerAccounts, setProviderAuth, startProviderOAuth, completeProviderOAuth, completeAutomaticProviderOAuth } = useCapabilities();
  const { connect, serverCapabilities } = useConnection();

  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [step, setStep] = useState<ProviderSetupStep>('method');
  const [selectedMethodIndex, setSelectedMethodIndex] = useState(0);
  const [authValues, setAuthValues] = useState<ProviderAuthValues>({});
  const [isConfiguringProvider, setIsConfiguringProvider] = useState(false);
  const [providerDialogError, setProviderDialogError] = useState<string>();
  const [oauthStage, setOAuthStage] = useState<ProviderOAuthStage>('idle');
  const [oauthInstructions, setOAuthInstructions] = useState<string>();
  const [oauthCode, setOAuthCode] = useState('');
  const [oauthError, setOAuthError] = useState<string>();
  const [feedback, setFeedback] = useState<ProviderFeedback>();
  // Invalidates in-flight OAuth completions when the flow is reset or restarted.
  const flowRef = useRef(0);

  const selectedProvider = useMemo(
    () => availableProviders.find((provider) => provider.id === selectedProviderId),
    [availableProviders, selectedProviderId],
  );
  const selectedProviderCopy = useMemo(
    () => (selectedProvider ? getProviderCopy(selectedProvider.id, selectedProvider.label, t) : undefined),
    [selectedProvider, t],
  );
  const effectiveAuthMethods = useMemo(
    () => buildEffectiveMethods(selectedProviderId ? providerAuthMethodsById[selectedProviderId] || [] : [], selectedProviderId, serverCapabilities.contract, t),
    [providerAuthMethodsById, selectedProviderId, serverCapabilities.contract, t],
  );
  const selectedMethod = effectiveAuthMethods[selectedMethodIndex];
  const visiblePrompts = useMemo(
    () =>
      (selectedMethod?.prompts || []).filter((prompt) =>
        (prompt.when ?? []).every((condition) =>
          condition.op === 'eq' ? authValues[condition.key] === condition.value : authValues[condition.key] !== condition.value,
        ),
      ),
    [authValues, selectedMethod],
  );

  const resetProviderDialog = useCallback(() => {
    flowRef.current += 1;
    setSelectedProviderId(undefined);
    setStep('method');
    setSelectedMethodIndex(0);
    setAuthValues({});
    setProviderDialogError(undefined);
    setOAuthStage('idle');
    setOAuthInstructions(undefined);
    setOAuthCode('');
    setOAuthError(undefined);
  }, []);

  const startProviderConfiguration = useCallback((providerId: string) => {
    const methods = buildEffectiveMethods(providerAuthMethodsById[providerId] || [], providerId, serverCapabilities.contract, t);
    flowRef.current += 1;
    setProviderDialogError(undefined);
    setOAuthStage('idle');
    setOAuthInstructions(undefined);
    setOAuthCode('');
    setOAuthError(undefined);
    setSelectedProviderId(providerId);
    setSelectedMethodIndex(0);
    setAuthValues(initialAuthValues(methods[0]));
    setStep(methods.length > 1 ? 'method' : 'configure');
  }, [providerAuthMethodsById, serverCapabilities.contract, t]);

  const selectMethod = useCallback((index: number) => {
    setSelectedMethodIndex(index);
    setAuthValues(initialAuthValues(effectiveAuthMethods[index]));
    setOAuthStage('idle');
    setOAuthError(undefined);
    setStep('configure');
  }, [effectiveAuthMethods]);

  const goBack = useCallback(() => {
    if (effectiveAuthMethods.length > 1) {
      setStep('method');
      setOAuthStage('idle');
      setProviderDialogError(undefined);
      return;
    }
    resetProviderDialog();
  }, [effectiveAuthMethods.length, resetProviderDialog]);

  const submitProviderConfiguration = useCallback(async () => {
    if (!selectedProviderId || !selectedMethod) return;

    const providerId = selectedProviderId;
    const methodIndex = selectedMethodIndex;
    const providerLabel = selectedProviderCopy?.label || providerId;
    const flowId = flowRef.current;
    setIsConfiguringProvider(true);
    setProviderDialogError(undefined);
    setOAuthError(undefined);

    try {
      if (selectedMethod.type === 'oauth') {
        const authorization = await startProviderOAuth(providerId, methodIndex, authValues);
        if (flowId !== flowRef.current) return;
        const url = authorization.url?.trim();
        // Code-based and headless/device flows surface the provider's pairing
        // instructions and an authorization-code field on this step.
        const needsCode = authorization.method === 'code' || !url || Boolean(authorization.instructions);
        if (needsCode) {
          if (url) {
            const result = await WebBrowser.openAuthSessionAsync(url, Linking.createURL(''));
            if (flowId !== flowRef.current) return;
            if (result.type === 'success') {
              const { code, error } = parseProviderOAuthRedirect(result.url);
              if (error) throw new Error(error);
              if (code) {
                await completeProviderOAuth(providerId, methodIndex, code);
                if (flowId !== flowRef.current) return;
                setFeedback({ type: 'success', message: t('settings:providers.signInFinished', { provider: providerLabel }) });
                resetProviderDialog();
                return;
              }
            }
          }
          setOAuthInstructions(authorization.instructions);
          setOAuthStage('code');
          return;
        }

        // Automatic OAuth completes on the server; wait on the attempt status
        // while the browser is open so the step advances on its own.
        setOAuthInstructions(authorization.instructions);
        setOAuthStage('pending');
        const waitPromise = completeAutomaticProviderOAuth(providerId);
        if (url) void WebBrowser.openAuthSessionAsync(url, Linking.createURL(''));
        await waitPromise;
        if (flowId !== flowRef.current) return;
        await connect();
        if (flowId !== flowRef.current) return;
        setFeedback({ type: 'success', message: t('settings:providers.signInFinished', { provider: providerLabel }) });
        resetProviderDialog();
        return;
      }

      if (serverCapabilities.contract === 'v2') {
        await providerAccounts.add(providerId, authValues);
      } else {
        await setProviderAuth(providerId, authValues);
      }
      if (flowId !== flowRef.current) return;
      setFeedback({ type: 'success', message: t('settings:providers.configuredSuccess', { provider: providerLabel }) });
      resetProviderDialog();
    } catch (error) {
      if (flowId !== flowRef.current) return;
      setProviderDialogError(error instanceof Error ? error.message : t('settings:providers.couldNotConfigure'));
      setOAuthStage('idle');
    } finally {
      if (flowId === flowRef.current) setIsConfiguringProvider(false);
    }
  }, [
    authValues,
    completeAutomaticProviderOAuth,
    completeProviderOAuth,
    connect,
    providerAccounts,
    resetProviderDialog,
    selectedMethod,
    selectedMethodIndex,
    selectedProviderCopy?.label,
    selectedProviderId,
    serverCapabilities.contract,
    setProviderAuth,
    startProviderOAuth,
    t,
  ]);

  const completeOAuthCode = useCallback(async () => {
    if (!selectedProviderId) return;
    const providerId = selectedProviderId;
    const providerLabel = selectedProviderCopy?.label || providerId;
    const flowId = flowRef.current;
    setIsConfiguringProvider(true);
    setOAuthError(undefined);
    try {
      await completeProviderOAuth(providerId, selectedMethodIndex, oauthCode);
      if (flowId !== flowRef.current) return;
      setFeedback({ type: 'success', message: t('settings:providers.signInFinished', { provider: providerLabel }) });
      resetProviderDialog();
    } catch (error) {
      if (flowId !== flowRef.current) return;
      setOAuthError(error instanceof Error ? error.message : t('settings:providers.couldNotComplete'));
    } finally {
      if (flowId === flowRef.current) setIsConfiguringProvider(false);
    }
  }, [completeProviderOAuth, oauthCode, resetProviderDialog, selectedMethodIndex, selectedProviderCopy?.label, selectedProviderId, t]);

  const handleAuthValueChange = useCallback((key: string, value: string | number | boolean | string[]) => {
    setAuthValues((current) => ({ ...current, [key]: value }));
  }, []);

  const dialog = selectedProvider ? (
    <ProviderConfigDialog
      authValues={authValues}
      error={providerDialogError}
      isConfiguringProvider={isConfiguringProvider}
      methods={effectiveAuthMethods}
      oauthCode={oauthCode}
      oauthError={oauthError}
      oauthInstructions={oauthInstructions}
      oauthStage={oauthStage}
      onAuthValueChange={handleAuthValueChange}
      onBack={goBack}
      onCancelOAuth={resetProviderDialog}
      onCompleteOAuth={() => void completeOAuthCode()}
      onDismiss={resetProviderDialog}
      onOAuthCodeChange={setOAuthCode}
      onSelectMethod={selectMethod}
      onSubmit={() => void submitProviderConfiguration()}
      palette={palette}
      providerDescription={selectedProviderCopy?.description}
      providerLabel={selectedProviderCopy?.label || selectedProvider.id}
      selectedMethod={selectedMethod}
      selectedMethodIndex={selectedMethodIndex}
      step={step}
      visiblePrompts={visiblePrompts}
    />
  ) : null;

  return {
    dialog,
    feedback,
    setFeedback,
    clearFeedback: useCallback(() => setFeedback(undefined), []),
    startProviderConfiguration,
  };
}
