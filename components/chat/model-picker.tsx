import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ControlButton } from '@/components/chat/chat-controls';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ModelOption } from '@/providers/opencode-provider';

type ModelPickerProps = {
  disabled?: boolean;
  models: ModelOption[];
  onSelect: (model: ModelOption) => void;
  recentModelIds?: string[];
  selectedModelId?: string;
  slim?: boolean;
};

function getSelectedModelLabel(models: ModelOption[], selectedModelId: string | undefined, fallback: string) {
  const selected = models.find((model) => model.id === selectedModelId);
  return selected ? `${selected.providerLabel} · ${selected.label}` : fallback;
}

export function ModelPicker({ disabled = false, models, onSelect, recentModelIds, selectedModelId, slim = false }: ModelPickerProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
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
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardHeight(event.endCoordinates.height));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const close = () => setVisible(false);
  const select = (model: ModelOption) => {
    close();
    onSelect(model);
  };
  const selected = models.find((model) => model.id === selectedModelId);
  const recentModels = (recentModelIds ?? [])
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is ModelOption => model !== undefined && model.id !== selectedModelId)
    .slice(0, 3);
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
      <ControlButton
        active={visible}
        disabled={disabled || models.length === 0}
        grow
        icon={(props) => renderProviderIcon(selected?.providerID, props.size, props.color)}
        maxWidth={220}
        onPress={() => setVisible(true)}
        slim={slim}
        testID="chat-model-picker-trigger">
        {getSelectedModelLabel(models, selectedModelId, t('chat:modelPicker.selectModel'))}
      </ControlButton>
      <Modal animationType="slide" transparent visible={visible} onRequestClose={close}>
        <View style={[styles.overlay, { paddingBottom: keyboardHeight }]}>
          <Pressable accessibilityLabel={t('chat:modelPicker.closePicker')} style={styles.backdrop} onPress={close} />
          <View testID="chat-model-picker" style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={[styles.header, { borderBottomColor: palette.border }]}>
                <Text style={[styles.title, { color: palette.text }]}>{t('chat:modelPicker.chooseModel')}</Text>
                <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                  <Text style={[styles.closeLabel, { color: palette.tint }]}>{t('common:actions.close')}</Text>
                </Pressable>
              </View>
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
              <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="always" style={styles.results}>
                {!normalizedQuery && selected ? (
                  <View style={styles.group}>
                    <Text style={[styles.sectionTitle, { color: palette.muted }]}>{t('chat:modelPicker.selected')}</Text>
                    {renderModelRow(selected, true)}
                  </View>
                ) : null}
                {!normalizedQuery && recentModels.length > 0 ? (
                  <View style={styles.group}>
                    <Text style={[styles.sectionTitle, { color: palette.muted }]}>{t('chat:modelPicker.recent')}</Text>
                    {recentModels.map((model) => renderModelRow(model, true))}
                  </View>
                ) : null}
                {providerGroups.map((group) => (
                  <View key={group.providerID} style={styles.group}>
                    <View style={styles.groupHeader}>
                      <View style={[styles.groupIcon, { backgroundColor: `${palette.tint}14` }]}>
                        {renderProviderIcon(group.providerID, 18, palette.tint)}
                      </View>
                      <Text style={[styles.groupTitle, { color: palette.text }]}>{group.label}</Text>
                    </View>
                    {group.models.map((model) => renderModelRow(model))}
                  </View>
                ))}
                {matchingModels.length === 0 ? (
                  <View style={styles.empty}>
                    <Text style={[styles.emptyTitle, { color: palette.text }]}>{t('chat:modelPicker.noMatchingModels')}</Text>
                    <Text style={[styles.emptyBody, { color: palette.muted }]}>{t('chat:modelPicker.emptyHint')}</Text>
                  </View>
                ) : null}
              </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.28)', zIndex: 0 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, elevation: 1, flexShrink: 1, maxHeight: '82%', overflow: 'hidden', zIndex: 1 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: Fonts.display, fontSize: 18, fontWeight: '700' },
  closeButton: { borderRadius: 999, minHeight: 36, justifyContent: 'center', paddingHorizontal: 10 },
  closeLabel: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '600' },
  searchShell: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, margin: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 16, minHeight: 46, paddingVertical: 0 },
  results: { flexShrink: 1 },
  list: { gap: 20, padding: 12, paddingBottom: 28 },
  group: { gap: 8 },
  sectionTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 2, textTransform: 'uppercase' },
  groupHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  groupIcon: { alignItems: 'center', borderRadius: 999, height: 30, justifyContent: 'center', width: 30 },
  groupTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  option: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 62, paddingHorizontal: 14, paddingVertical: 12 },
  optionText: { flex: 1, gap: 3, minWidth: 0 },
  optionLabel: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600' },
  optionDescription: { fontFamily: Fonts.sans, fontSize: 13 },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 32 },
  emptyTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  emptyBody: { fontFamily: Fonts.sans, fontSize: 14 },
  pressed: { opacity: 0.82 },
});
