import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ActivityIndicator, Button, Divider, List, Text, TextInput as PaperTextInput } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { File } from '@/lib/opencode/types';
import type { WorkspaceFilesContextValue } from '@/providers/opencode-provider-types';

export function FilesPanel({ statuses, browser, workspaceLabel, onOpen }: {
  statuses: File[];
  browser: WorkspaceFilesContextValue['browser'];
  workspaceLabel: string;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const [query, setQuery] = useState(browser.query || '');
  const { initialized, openDirectory } = browser;
  useEffect(() => { if (!initialized) void openDirectory(''); }, [initialized, openDirectory]);
  const busy = browser.loading || browser.searching;
  const crumbs = browser.path ? browser.path.split('/') : [];
  const search = () => { if (query.trim() && !busy) void browser.search(query); };
  const entries = browser.query ? browser.results.map((path) => ({ path, name: path, type: 'file' as const })) : browser.entries;

  return <View style={{ gap: 12 }}>
    <TextInput testID="workspace-file-search" mode="outlined" dense
      accessibilityLabel={t('workspace:files.searchPlaceholder')}
      placeholder={t('workspace:files.searchPlaceholder')} value={query} onChangeText={(value) => {
        setQuery(value);
        if (!value.trim()) void browser.search('');
      }} autoCapitalize="none" autoCorrect={false} returnKeyType="search" blurOnSubmit
      onSubmitEditing={search}
      left={query ? <PaperTextInput.Icon icon="close" accessibilityLabel={t('workspace:files.clearSearch')} onPress={() => { setQuery(''); void browser.search(''); }} /> : undefined}
      right={<PaperTextInput.Icon icon="magnify" accessibilityLabel={t('workspace:files.search')} disabled={busy || !query.trim()} onPress={search} />} />
    <Text style={{ color: palette.muted }}>{t('workspace:files.searchScope', { workspace: workspaceLabel })}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
      <Button compact icon="folder-outline" onPress={() => { setQuery(''); void openDirectory(''); }}>{workspaceLabel}</Button>
      {crumbs.map((crumb, index) => <View key={index} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: palette.muted }}>›</Text>
        <Button compact onPress={() => { setQuery(''); void openDirectory(crumbs.slice(0, index + 1).join('/')); }}>{crumb}</Button>
      </View>)}
    </View>
    {busy ? <ActivityIndicator accessibilityLabel={t('workspace:files.loading')} /> : null}
    <Text accessibilityLiveRegion="polite" style={{ color: browser.error ? palette.danger : palette.muted }}>
      {browser.error || (browser.searching ? t('workspace:files.searching') : browser.query ? entries.length ? t('workspace:files.resultsFor', { query: browser.query }) : t('workspace:files.noMatches', { query: browser.query }) : !browser.loading && initialized && !entries.length ? t('workspace:files.emptyFolder') : '')}
    </Text>
    {browser.error ? <Button onPress={() => { if (browser.query) void browser.search(browser.query); else void openDirectory(browser.path); }}>{t('common:actions.retry')}</Button> : null}
    {!busy && !browser.error ? entries.map((entry) => <View key={entry.path}>
      <List.Item accessibilityRole="button" testID={`workspace-entry-${entry.path}`} title={entry.name} titleNumberOfLines={2}
        accessibilityLabel={t(entry.type === 'directory' ? 'workspace:files.openFolder' : 'workspace:files.openFile', { path: entry.path })}
        left={(props) => <List.Icon {...props} color={entry.type === 'directory' ? palette.tint : palette.muted} icon={entry.type === 'directory' ? 'folder-outline' : 'file-document-outline'} />}
        right={entry.type === 'directory' ? (props) => <List.Icon {...props} icon="chevron-right" /> : undefined}
        onPress={() => { if (entry.type === 'directory') { setQuery(''); void openDirectory(entry.path); } else onOpen(entry.path); }} />
      <Divider />
    </View>) : null}
    {statuses.length ? <Text variant="titleSmall">{t('workspace:files.changedFiles', { value: statuses.length })}</Text> : null}
    {statuses.map((file) => <List.Item accessibilityRole="button" key={file.path} title={file.path} titleNumberOfLines={2}
      description={file.status === 'deleted' ? `${t('workspace:files.deleted')} · ${t('workspace:files.deletedUnavailable')}` : t(`workspace:files.${file.status}`)}
      descriptionNumberOfLines={3} disabled={file.status === 'deleted'}
      onPress={file.status === 'deleted' ? undefined : () => onOpen(file.path)} />)}
  </View>;
}
