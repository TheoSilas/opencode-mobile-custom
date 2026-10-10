import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { OpencodeProject } from '@/providers/opencode-provider-types';

/**
 * Presentational project row list shared by the workspace picker overlay and
 * the onboarding workspace step. Callers own empty/loading states.
 */
export function ProjectOptions({
  projects,
  activePath,
  onSelect,
  onHide,
}: {
  projects: OpencodeProject[];
  activePath?: string;
  onSelect: (path: string) => void;
  onHide?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];

  return (
    <>
      {projects.map((project) => (
        <View key={project.path} style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('workspace:picker.selectLabel', { name: project.label })}
            onPress={() => onSelect(project.path)}
            style={[
              styles.project,
              {
                borderColor: project.path === activePath ? palette.tint : palette.border,
                backgroundColor: project.path === activePath ? palette.background : 'transparent',
              },
            ]}>
            <MaterialCommunityIcons
              name={project.path === activePath ? 'check-circle' : 'folder-outline'}
              size={20}
              color={project.path === activePath ? palette.tint : palette.muted}
            />
            <View style={styles.projectText}>
              <NativeText style={[styles.projectTitle, { color: palette.text }]}>{project.label}</NativeText>
              <NativeText numberOfLines={1} style={{ color: palette.muted }}>{project.path}</NativeText>
            </View>
          </Pressable>
          {onHide && project.path !== activePath ? <Pressable accessibilityRole="button"
            accessibilityLabel={t('workspace:picker.hideNamed', { name: project.label })}
            onPress={() => onHide(project.path)} style={styles.hideButton}>
            <MaterialCommunityIcons name="eye-off-outline" size={22} color={palette.muted} />
          </Pressable> : null}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  project: { flex: 1, minHeight: 68, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  hideButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  projectText: { flex: 1, gap: 3 },
  projectTitle: { fontSize: 16, fontWeight: '600' },
});
