import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { NumericSlider } from '@/components/ui/numeric-slider';
import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { REASONING_OPTIONS } from '@/components/chat/chat-view-utils';
import { ControlButton } from '@/components/chat/chat-controls';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ModelOption, ProviderOption, ReasoningLevel } from '@/providers/opencode-provider';
import type { CapabilitiesContextValue } from '@/providers/opencode-provider-types';
import { getAccountBindingMismatchDiagnostic, getAccountBindingRequestDiagnostic } from '@/lib/opencode/account-binding-status';

function isUnsupportedAccountError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /SESSION_ACCOUNT_BINDING_UNSUPPORTED/.test(message);
}

function formatAccountError(error: unknown, t: (key: string) => string, action: 'read' | 'bind') {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const requestDiagnostic = getAccountBindingRequestDiagnostic(message);
  if (/SESSION_ACCOUNT_BINDING_UNSUPPORTED/.test(message)) return `${t('chat:accounts.protocolUnsupported')}${requestDiagnostic ? ` · ${requestDiagnostic}` : ''}`;
  if (/SESSION_ACCOUNT_BINDING_UNKNOWN/.test(message)) return t('chat:accounts.bindingUnknown');
  const status = message.match(/\b(401|403|404|405|409|422|500|501|502|503)\b/)?.[1];
  if (isUnsupportedAccountError(error)) return t('chat:accounts.protocolUnsupported');
  if (status === '401' || status === '403') return `${t(action === 'read' ? 'chat:accounts.readAuthFailed' : 'chat:accounts.bindingAuthFailed')}${requestDiagnostic ? ` · ${requestDiagnostic}` : ''}`;
  if (action === 'read') return `${t('chat:accounts.readFailed')}${requestDiagnostic ? ` · ${requestDiagnostic}` : status ? `（HTTP ${status}）` : message ? `：${message}` : ''}`;
  if (/did not confirm/i.test(message)) {
    const trace = getAccountBindingMismatchDiagnostic(message);
    return `${t('chat:accounts.bindingNotConfirmed')}${trace ? ` · ${trace}` : ''}`;
  }
  if (/unavailable|not found/i.test(message)) return t('chat:accounts.bindingAccountUnavailable');
  return `${t('chat:accounts.bindingFailed')}${status ? `（HTTP ${status}）` : message ? `：${message}` : ''}`;
}

type ModelPickerProps = {
  disabled?: boolean;
  compact?: boolean;
  reasoningLabel?: string;
  reasoning?: ReasoningLevel;
  onReasoningChange?: (value: ReasoningLevel) => void;
  models: ModelOption[];
  providers?: ProviderOption[];
  accountActions?: CapabilitiesContextValue['providerAccounts'];
  supportsAccounts?: boolean;
  sessionId?: string;
  sessionCredentialID?: string;
  taskSelection?: { credentialID?: string; modelId?: string };
  onSelect: (model: ModelOption) => void;
  recentModelIds?: string[];
  selectedModelId?: string;
  slim?: boolean;
};

function getSelectedModelLabel(models: ModelOption[], selectedModelId: string | undefined, fallback: string) {
  const selected = models.find((model) => model.id === selectedModelId);
  return selected ? `${selected.label} · ${selected.providerLabel}` : fallback;
}

export function ModelPicker({ disabled = false, models, providers, accountActions, supportsAccounts, sessionId, sessionCredentialID, taskSelection, onSelect, recentModelIds, selectedModelId, slim = false, compact = false, reasoningLabel, reasoning, onReasoningChange }: ModelPickerProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [busyAccount, setBusyAccount] = useState<string>();
  const [accountStatus, setAccountStatus] = useState<'ready' | 'checking' | 'error'>('ready');
  const [bindingStatus, setBindingStatus] = useState<'not-read' | 'checking' | 'bound' | 'unbound' | 'error' | 'unsupported' | 'no-session'>(supportsAccounts === false ? 'unsupported' : 'not-read');
  const [bindingRefresh, setBindingRefresh] = useState(0);
  const [confirmedCredentialID, setConfirmedCredentialID] = useState(sessionCredentialID);
  const [bindingError, setBindingError] = useState('');
  const [accountFeedback, setAccountFeedback] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [newLabel, setNewLabel] = useState('');
  const keyboardHeight = useKeyboardHeight(visible);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingModels = useMemo(
    () => models.filter((model) => {
      if (!normalizedQuery) {
        return true;
      }

      return [model.label, model.modelID, model.providerLabel, model.providerID].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    }),
    [models, normalizedQuery],
  );
  const providerGroups = useMemo(() => {
    const groups = new Map<string, { label: string; models: ModelOption[] }>();

    matchingModels.forEach((model) => {
      const group = groups.get(model.providerID);
      if (group) {
        group.models.push(model);
        return;
      }

      groups.set(model.providerID, { label: model.providerLabel, models: [model] });
    });

    return [...groups.entries()].map(([providerID, group]) => ({ providerID, ...group }));
  }, [matchingModels]);

  useEffect(() => {
    if (!visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the search when the picker closes.
      setQuery('');
    }
  }, [visible]);

  useEffect(() => {
    if (supportsAccounts === false) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- contract resolution invalidates prior state.
      setBindingStatus('unsupported');
      setBindingError('');
      return;
    }
    if (supportsAccounts === undefined) {
      // Protocol has not been established yet; unknown must never claim unsupported.
      setBindingStatus('not-read');
      setBindingError('');
      return;
    }
    if (!accountActions) {
      setBindingStatus('error');
      setBindingError(t('chat:accounts.notChecked'));
      return;
    }
    if (!sessionId) {
      setBindingStatus('no-session');
      setConfirmedCredentialID(undefined);
      return;
    }
    let cancelled = false;
    setBindingStatus('checking');
    setBindingError('');
    void accountActions.readSessionBinding(sessionId).then((credentialID) => {
      if (cancelled) return;
      setConfirmedCredentialID(credentialID);
      setBindingStatus(credentialID ? 'bound' : 'unbound');
    }).catch((error: unknown) => {
      if (cancelled) return;
      setBindingStatus(isUnsupportedAccountError(error) ? 'unsupported' : 'error');
      setBindingError(formatAccountError(error, t, 'read'));
    });
    return () => { cancelled = true; };
  }, [accountActions, bindingRefresh, sessionId, supportsAccounts, t]);

  const close = () => setVisible(false);
  const open = () => {
    Keyboard.dismiss();
    setVisible(true);
    if (sessionId && supportsAccounts) setBindingRefresh((current) => current + 1);
    if (supportsAccounts && accountActions && selectedModelId) {
      setBusyAccount('refresh');
      setAccountStatus('checking');
      setAccountFeedback('');
      void accountActions.refresh().then(() => setAccountStatus('ready')).catch((error) => {
        setAccountStatus('error');
        setAccountFeedback(error instanceof Error ? error.message : t('chat:accounts.failed'));
      }).finally(() => setBusyAccount(undefined));
    }
  };
  useDismissOnBack(visible, close);
  const select = (model: ModelOption) => {
    close();
    onSelect(model);
  };
  const selected = models.find((model) => model.id === selectedModelId);
  const selectedProvider = providers?.find((provider) => provider.id === selected?.providerID);
  const accounts = (selectedProvider?.accounts ?? []).filter((account) => !account.integrationId || account.integrationId === selectedProvider?.requestIntegrationId);
  const boundAccount = accounts.find((account) => account.id === confirmedCredentialID);
  const activeAccount = accounts.find((account) => account.active);
  const taskAccount = taskSelection?.credentialID
    ? providers?.flatMap((provider) => provider.accounts ?? []).find((account) => account.id === taskSelection.credentialID)
    : undefined;
  async function changeAccount(id: string, action: () => Promise<void>, success: string, binding = false) {
    setBusyAccount(id);
    setAccountFeedback('');
    try {
      await action();
      setAccountStatus('ready');
      setAccountFeedback(success);
      if (binding) {
        setConfirmedCredentialID(id);
        setBindingStatus('bound');
        setBindingError('');
      }
      setRenaming(undefined);
    } catch (error) {
      const reason = formatAccountError(error, t, 'bind');
      setAccountFeedback(reason);
      if (binding && isUnsupportedAccountError(error)) setBindingStatus('unsupported');
      else if (binding && /SESSION_ACCOUNT_BINDING_UNKNOWN/.test(error instanceof Error ? error.message : String(error ?? ''))) {
        setBindingStatus('error');
        setBindingError(reason);
      }
    } finally {
      setBusyAccount(undefined);
    }
  }
  const nextAccountLabel = bindingStatus === 'bound'
    ? boundAccount?.label || t('chat:accounts.accountUnavailable')
    : bindingStatus === 'unbound'
      ? activeAccount?.label || t('chat:accounts.serverDefault')
      : bindingStatus === 'unsupported'
        ? t('chat:accounts.upgradeRequired')
        : bindingStatus === 'error'
          ? t('chat:accounts.readFailedShort')
          : bindingStatus === 'no-session'
            ? t('chat:accounts.createChatFirst')
            : t('chat:accounts.notChecked');
  const accountSummaryLabel = bindingStatus === 'bound'
    ? `${t('chat:accounts.confirmed')}: ${boundAccount?.label || t('chat:accounts.accountUnavailable')}`
    : bindingStatus === 'unbound'
      ? `${t('chat:accounts.unbound')}: ${activeAccount?.label || t('chat:accounts.serverDefault')}`
      : bindingStatus === 'unsupported'
        ? t('chat:accounts.upgradeRequired')
        : bindingStatus === 'error'
          ? t('chat:accounts.readFailedShort')
          : bindingStatus === 'no-session'
            ? t('chat:accounts.createChatFirst')
            : t('chat:accounts.notChecked');
  const selectedModelLabel = getSelectedModelLabel(models, selectedModelId, t('chat:modelPicker.selectModel'));
  const taskModel = taskSelection?.modelId ? models.find((model) => model.id === taskSelection.modelId) : undefined;
  const taskModelLabel = taskSelection?.modelId
    ? taskModel?.label || taskSelection.modelId
    : t('chat:accounts.taskModelUnconfirmed');
  const taskSummaryLabel = `${t('chat:accounts.currentTask')}: ${taskSelection?.credentialID ? (taskAccount?.label || t('chat:accounts.accountUnavailable')) : t('chat:accounts.taskAccountUnconfirmed')} · ${taskModelLabel}`;
  const nextSummaryLabel = `${t('chat:accounts.nextSend')}: ${nextAccountLabel} · ${selected?.label || t('chat:modelPicker.selectModel')}`;
  const recentModels = useMemo(() => (recentModelIds ?? [])
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is ModelOption => model !== undefined && model.id !== selectedModelId)
    .slice(0, 3), [models, recentModelIds, selectedModelId]);
  const sections = useMemo(() => [
    ...(!normalizedQuery && selected ? [{ key: 'selected', title: t('chat:modelPicker.selected'), providerID: undefined, data: [selected] }] : []),
    ...(!normalizedQuery && recentModels.length > 0 ? [{ key: 'recent', title: t('chat:modelPicker.recent'), providerID: undefined, data: recentModels }] : []),
    ...providerGroups.map((group) => ({ key: `provider:${group.providerID}`, title: group.label, providerID: group.providerID, data: group.models })),
  ], [normalizedQuery, selected, recentModels, providerGroups, t]);
  const renderModelRow = (model: ModelOption, showProvider = false) => {
    const isSelected = model.id === selectedModelId;
    return (
      <Pressable
        key={model.id}
        accessibilityRole="button"
        onPress={() => select(model)}
        style={({ pressed }) => [
          styles.option,
          { backgroundColor: isSelected ? palette.background : palette.surface, borderColor: isSelected ? palette.tint : palette.border },
          pressed && styles.pressed,
        ]}>
        <View style={styles.optionText}>
          <Text style={[styles.optionLabel, { color: palette.text }]}>{model.label}</Text>
          <Text style={[styles.optionDescription, { color: palette.muted }]}>
            {showProvider ? `${model.providerLabel} · ${model.modelID}` : model.modelID}
            {model.supportsReasoning ? t('chat:modelPicker.reasoningSupported') : t('chat:modelPicker.standardModel')}
          </Text>
        </View>
        {isSelected ? <MaterialCommunityIcons name="check" size={20} color={palette.tint} /> : null}
      </Pressable>
    );
  };

  return (
    <>
      {compact ? (
        <Pressable
          testID="chat-model-picker-trigger"
          accessibilityRole="button"
            accessibilityLabel={`${supportsAccounts ? `${taskSelection ? `${taskSummaryLabel} · ` : ''}${nextSummaryLabel}` : selectedModelLabel}${reasoningLabel ? ` · ${reasoningLabel}` : ''}`}
          accessibilityState={{ disabled: disabled || models.length === 0 }}
          disabled={disabled || models.length === 0}
           onPress={open}
          style={({ pressed }) => [styles.summary, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
            {supportsAccounts && taskSelection ? <Text testID="chat-current-task-account" maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.summaryReasoning, { color: palette.muted }]}>{taskSummaryLabel}</Text> : null}
            <Text testID="chat-next-send-account-model" maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.summaryReasoning, { color: palette.text }]}>{supportsAccounts ? (taskSelection ? nextSummaryLabel : `${selectedModelLabel} · ${accountSummaryLabel}`) : selectedModelLabel}</Text>
           {reasoningLabel ? <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.summaryReasoning, { color: palette.text }]}>{reasoningLabel}</Text> : null}
        </Pressable>
      ) : (
        <ControlButton
          active={visible}
          disabled={disabled || models.length === 0}
          grow
          icon={(props) => renderProviderIcon(selected?.providerID, props.size, props.color)}
           onPress={open}
          slim={slim}
          testID="chat-model-picker-trigger">
            {`${selectedModelLabel} · ${accountSummaryLabel}`}
        </ControlButton>
      )}
      <Modal animationType="slide" transparent visible={visible} onRequestClose={close}>
        <View style={[styles.overlay, { paddingBottom: keyboardHeight }]}>
          <Pressable accessible={false} style={styles.backdrop} onPress={close} />
          <View testID="chat-model-picker" style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={[styles.header, { borderBottomColor: palette.border }]}>
                <Text style={[styles.title, { color: palette.text }]}>{t('chat:modelPicker.chooseModel')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('chat:modelPicker.closePicker')} onPress={close} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                  <Text style={[styles.closeLabel, { color: palette.tint }]}>{t('common:actions.close')}</Text>
                </Pressable>
              </View>
               {reasoning && onReasoningChange ? (
                <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                  <NumericSlider
                    label={t('chat:composer.reasoning')}
                    minimum={0}
                    maximum={REASONING_OPTIONS.length - 1}
                    step={1}
                    value={Math.max(0, REASONING_OPTIONS.findIndex((option) => option.id === reasoning))}
                    valueLabel={reasoningLabel || t(REASONING_OPTIONS.find((option) => option.id === reasoning)?.labelKey || 'chat:reasoning.default')}
                    onValueChange={(index) => onReasoningChange(REASONING_OPTIONS[index].id)}
                    palette={palette}
                  />
                </View>
               ) : null}
                {selectedProvider ? (
                  <View testID="chat-account-panel" style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}>
                    {supportsAccounts !== true || !accountActions ? (
                      <Text accessibilityRole="alert" style={{ color: supportsAccounts === false ? palette.warning : palette.muted }}>
                        {supportsAccounts === false ? t('chat:accounts.upgradeRequired') : t('chat:accounts.notChecked')}
                      </Text>
                    ) : <>
                      <Text testID="chat-account-binding-status" style={{ color: bindingStatus === 'error' || bindingStatus === 'unsupported' ? palette.danger : palette.text }}>
                        {bindingStatus === 'checking' ? t('chat:accounts.reading')
                          : bindingStatus === 'bound' ? `${t('chat:accounts.chatAccount')}: ${boundAccount?.label || t('chat:accounts.accountUnavailable')} · ${t('chat:accounts.confirmed')}`
                            : bindingStatus === 'unbound' ? `${t('chat:accounts.chatAccount')}: ${t('chat:accounts.unboundConfirmed')}`
                              : bindingStatus === 'unsupported' ? t('chat:accounts.protocolUnsupported')
                              : bindingStatus === 'error' ? `${t('chat:accounts.readFailed')}: ${bindingError}`
                                : bindingStatus === 'no-session' ? t('chat:accounts.createChatFirst')
                                  : t('chat:accounts.notChecked')}</Text>
                      <Text style={{ color: palette.muted, fontSize: 12 }}>{t('chat:accounts.sessionHint')}</Text>
                    </>}
                    {supportsAccounts && accountActions && (accountStatus === 'error' || selectedProvider.accountReadStatus === 'error') ? (
                      <Text accessibilityRole="alert" style={{ color: palette.danger }}>{formatAccountError(new Error(selectedProvider.accountReadError || accountFeedback || ''), t, 'read')}</Text>
                    ) : null}
                    {supportsAccounts && accountActions && accountStatus !== 'error' && selectedProvider.accountReadStatus !== 'error' && accounts.length > 0 ? (
                      <>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {accounts.map((account, index) => <View key={account.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Pressable testID={`chat-account-option-${account.id}`} disabled={!!busyAccount || (bindingStatus !== 'bound' && bindingStatus !== 'unbound') || account.id === confirmedCredentialID} accessibilityRole="radio"
                                aria-checked={account.id === confirmedCredentialID}
                                accessibilityState={{ checked: account.id === confirmedCredentialID, disabled: !!busyAccount || (bindingStatus !== 'bound' && bindingStatus !== 'unbound') || account.id === confirmedCredentialID }}
                               accessibilityLabel={`${account.label}${account.id === confirmedCredentialID ? `, ${t('chat:accounts.confirmed')}` : ''}`}
                                onPress={() => void changeAccount(account.id, () => accountActions.bindSession(account.id, sessionId), t('chat:accounts.switched'), true)}
                               style={[styles.option, { marginBottom: 0, minHeight: 44, borderColor: account.id === confirmedCredentialID ? palette.tint : palette.border, backgroundColor: palette.surface }]}>
                               <MaterialCommunityIcons name={account.id === confirmedCredentialID ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={account.id === confirmedCredentialID ? palette.tint : palette.muted} />
                               <Text style={{ color: palette.text }}>{account.label}{accounts.filter((item) => item.label === account.label).length > 1 ? ` (${index + 1})` : ''}</Text>
                            </Pressable>
                           <Pressable accessibilityRole="button" accessibilityLabel={`${t('chat:accounts.name')}: ${account.label}`} onPress={() => { setRenaming(account.id); setNewLabel(account.label); }} style={{ padding: 10 }}>
                             <MaterialCommunityIcons name="pencil" size={18} color={palette.tint} />
                           </Pressable>
                         </View>)}
                       </View>
                       {renaming ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                         <TextInput accessibilityLabel={t('chat:accounts.name')} value={newLabel} onChangeText={setNewLabel} style={[styles.searchInput, { color: palette.text, flex: 1 }]} />
                         <Pressable accessibilityRole="button" onPress={() => void changeAccount(renaming, () => accountActions.rename(renaming, newLabel), t('chat:accounts.renamed'))}>
                           <Text style={{ color: palette.tint }}>{t('chat:accounts.save')}</Text>
                         </Pressable>
                       </View> : null}
                     </>
                    ) : supportsAccounts && accountActions && accountStatus !== 'error' && selectedProvider.accountReadStatus !== 'error' ? (
                       <Text accessibilityRole="alert" style={{ color: palette.muted }}>
                        {accountStatus === 'checking' ? t('chat:accounts.switching') : t('chat:accounts.empty')}
                      </Text>
                    ) : null}
                    {busyAccount ? <Text accessibilityRole="alert" style={{ color: palette.muted }}>{t('chat:accounts.switching')}</Text> : null}
                    {busyAccount && busyAccount !== 'refresh' ? <Text accessibilityRole="alert" style={{ color: palette.muted }}>{t('chat:accounts.savingBinding')}</Text> : null}
                    {accountFeedback ? <Text accessibilityRole="alert" style={{ color: accountStatus === 'error' ? palette.danger : palette.text }}>{accountFeedback}</Text> : null}
                  </View>
                ) : null}
              <View style={[styles.searchShell, { backgroundColor: palette.background, borderColor: palette.border }]}>
                <MaterialCommunityIcons name="magnify" size={20} color={palette.muted} />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  cursorColor={palette.tint}
                  placeholder={t('chat:modelPicker.searchPlaceholder')}
                  placeholderTextColor={palette.muted}
                  selectionColor={palette.tint}
                  style={[styles.searchInput, { color: palette.text }]}
                  testID="chat-model-picker-search"
                  value={query}
                  onChangeText={setQuery}
                />
              </View>
              <SectionList
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="always"
                style={styles.results}
                sections={sections}
                keyExtractor={(model) => model.id}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={5}
                stickySectionHeadersEnabled={false}
                renderItem={({ item, section }) => renderModelRow(item, !section.providerID)}
                renderSectionHeader={({ section }) => section.providerID ? (
                    <View style={styles.groupHeader}>
                      <View style={[styles.groupIcon, { backgroundColor: `${palette.tint}14` }]}>
                        {renderProviderIcon(section.providerID, 18, palette.tint)}
                      </View>
                      <Text style={[styles.groupTitle, { color: palette.text }]}>{section.title}</Text>
                    </View>
                ) : <Text style={[styles.sectionTitle, { color: palette.muted }]}>{section.title}</Text>}
                ListEmptyComponent={(
                  <View style={styles.empty}>
                    <Text style={[styles.emptyTitle, { color: palette.text }]}>{t('chat:modelPicker.noMatchingModels')}</Text>
                    <Text style={[styles.emptyBody, { color: palette.muted }]}>{t('chat:modelPicker.emptyHint')}</Text>
                  </View>
                )}
              />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  summary: { justifyContent: 'center', alignItems: 'flex-end', minHeight: 44, gap: 0, paddingHorizontal: 4 },
  summaryModel: { maxWidth: '100%', fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  summaryReasoning: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.28)', zIndex: 0 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, elevation: 1, height: '82%', overflow: 'hidden', zIndex: 1 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: Fonts.display, fontSize: 18, fontWeight: '700' },
  closeButton: { borderRadius: 999, minHeight: 36, justifyContent: 'center', paddingHorizontal: 10 },
  closeLabel: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '600' },
  searchShell: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, margin: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 16, minHeight: 46, paddingVertical: 0 },
  results: { flex: 1 },
  list: { padding: 12, paddingBottom: 28 },
  sectionTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 2, paddingVertical: 8, textTransform: 'uppercase' },
  groupHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 2, paddingVertical: 8 },
  groupIcon: { alignItems: 'center', borderRadius: 999, height: 30, justifyContent: 'center', width: 30 },
  groupTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  option: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, marginBottom: 8, minHeight: 62, paddingHorizontal: 14, paddingVertical: 12 },
  optionText: { flex: 1, gap: 3, minWidth: 0 },
  optionLabel: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600' },
  optionDescription: { fontFamily: Fonts.sans, fontSize: 13 },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 32 },
  emptyTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  emptyBody: { fontFamily: Fonts.sans, fontSize: 14 },
  pressed: { opacity: 0.82 },
});
