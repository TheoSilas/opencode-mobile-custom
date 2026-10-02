import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Button, Chip, List, Text } from 'react-native-paper';

import {
  ConnectionProfileDialog,
  type ConnectionProfileFormValues,
} from '@/components/settings/connection-profile-dialog';
import { Colors } from '@/constants/theme';
import {
  createProfileId,
  deleteProfilePassword,
  findMatchingProfile,
  getProfilePassword,
  loadConnectionProfiles,
  saveConnectionProfiles,
  saveProfilePassword,
  type ConnectionProfile,
} from '@/lib/connection-profiles';
import { useConnection } from '@/providers/opencode-contexts';

type Palette = typeof Colors.light;

const CURRENT_CONNECTION_KEY = 'current';

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit-profile'; profile: ConnectionProfile; password: string }
  | { mode: 'edit-current' };

function connectionHost(serverUrl: string) {
  try {
    return new URL(serverUrl).host || serverUrl;
  } catch {
    return serverUrl;
  }
}

export function ConnectionProfiles({ palette, onManageConnect }: { palette: Palette; onManageConnect?: () => void }) {
  const { t } = useTranslation();
  const { settings, connection, connect, switchConnection, updateSettings, connectSetup } = useConnection();
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [expandedKey, setExpandedKey] = useState<string>();
  const [switchingProfileId, setSwitchingProfileId] = useState<string>();
  const [dialog, setDialog] = useState<DialogState>();

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void loadConnectionProfiles().then((stored) => { if (mounted) setProfiles(stored); });
    return () => { mounted = false; };
  }, []));

  const activeProfile = findMatchingProfile(profiles, { serverUrl: settings.serverUrl, username: settings.username });
  const isReconnecting = connection.status === 'connecting';
  function manageConnect(profile: ConnectionProfile) {
    connectSetup.selectControlPlane(profile.connect!.controlPlaneUrl);
    onManageConnect?.();
  }

  async function persist(next: ConnectionProfile[]) {
    setProfiles(next);
    await saveConnectionProfiles(next);
  }

  async function handleConnect(profile: ConnectionProfile) {
    if (switchingProfileId) {
      return;
    }
    setSwitchingProfileId(profile.id);
    try {
      const password = await getProfilePassword(profile.id);
      // switchConnection persists the outgoing profile's model preferences,
      // clears server-derived state, restores this profile's preferences, and
      // reconnects with these credentials.
      await switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password }, profile.modelPreferences);
    } finally {
      setSwitchingProfileId(undefined);
    }
  }

  async function handleEditProfile(profile: ConnectionProfile) {
    const password = await getProfilePassword(profile.id);
    setDialog({ mode: 'edit-profile', profile, password });
  }

  function handleDelete(profile: ConnectionProfile) {
    const message = t('settings:connection.deleteMessage', { name: profile.name });
    const confirmRemoval = () => {
      void deleteProfilePassword(profile.id);
      void persist(profiles.filter((item) => item.id !== profile.id));
    };

    // React Native Web has no Alert, so follow the app's existing pattern of a
    // browser confirm dialog for web.
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('settings:connection.deleteWebConfirm', { message }))) {
        confirmRemoval();
      }
      return;
    }

    Alert.alert(t('settings:connection.deleteTitle'), message, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: confirmRemoval },
    ]);
  }

  async function handleDialogSubmit(values: ConnectionProfileFormValues) {
    const currentDialog = dialog;
    if (!currentDialog) {
      return;
    }

    if (currentDialog.mode === 'add') {
      const profile: ConnectionProfile = {
        id: createProfileId(),
        name: values.name,
        serverUrl: values.serverUrl,
        username: values.username,
      };
      await saveProfilePassword(profile.id, values.password);
      await persist([...profiles, profile]);
      setDialog(undefined);
      setExpandedKey(profile.id);
      // Show the new row as connecting while the switch runs.
      setSwitchingProfileId(profile.id);
      try {
        await switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password: values.password });
      } finally {
        setSwitchingProfileId(undefined);
      }
      return;
    }

    if (currentDialog.mode === 'edit-profile') {
      const updated: ConnectionProfile = {
        ...currentDialog.profile,
        name: values.name,
        serverUrl: values.serverUrl,
        username: values.username,
      };
      await saveProfilePassword(updated.id, values.password);
      await persist(profiles.map((item) => (item.id === updated.id ? updated : item)));
      setDialog(undefined);
      if (updated.id === activeProfile?.id) {
        // Editing the active connection applies to the live settings but waits
        // for the user to reconnect, so an in-flight session is never dropped.
        updateSettings({ serverUrl: values.serverUrl, username: values.username, password: values.password });
      }
      return;
    }

    // Editing the current, not-yet-saved connection only touches live settings.
    updateSettings({ serverUrl: values.serverUrl, username: values.username, password: values.password });
    setDialog(undefined);
  }

  function renderRow({
    rowKey,
    testIDKey,
    name,
    subtitle,
    isActive,
    isSwitching,
    actions,
    body,
  }: {
    rowKey: string;
    testIDKey: string;
    name: string;
    subtitle: string;
    isActive: boolean;
    isSwitching?: boolean;
    actions: React.ReactNode;
    body: React.ReactNode;
  }) {
    const expanded = expandedKey === rowKey;
    return (
      <View key={rowKey} style={[styles.row, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <Pressable
          testID={`connection-row-${testIDKey}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpandedKey(expanded ? undefined : rowKey)}
          style={styles.rowHeader}>
          <List.Icon icon={expanded ? 'chevron-down' : 'chevron-right'} color={palette.muted} />
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} variant="titleSmall" style={{ color: palette.text }}>{name}</Text>
            <Text numberOfLines={1} variant="bodySmall" style={{ color: palette.muted }}>{subtitle}</Text>
          </View>
          {isSwitching || isActive ? (
            <Chip compact mode="flat">{isSwitching || isReconnecting ? t('common:labels.connecting') : t('common:labels.active')}</Chip>
          ) : null}
        </Pressable>
        {expanded ? (
          <View style={styles.rowBody}>
            {body}
            <View style={styles.actions}>{actions}</View>
          </View>
        ) : null}
      </View>
    );
  }

  const rows: React.ReactNode[] = [];

  // The active connection is always editable, even when it has not been saved
  // as a profile yet.
  if (!activeProfile) {
    rows.push(renderRow({
      rowKey: CURRENT_CONNECTION_KEY,
      testIDKey: CURRENT_CONNECTION_KEY,
      name: t('settings:connection.currentConnection'),
      subtitle: settings.serverUrl.trim() ? connectionHost(settings.serverUrl) : t('settings:connection.noServerUrl'),
      isActive: true,
      actions: (
        <>
          <Button
            testID="connection-reconnect"
            mode="contained"
            loading={isReconnecting}
            disabled={isReconnecting || !settings.serverUrl.trim()}
            onPress={() => void connect()}>
            {t('common:actions.reconnect')}
          </Button>
          <Button testID="connection-edit-current" mode="outlined" onPress={() => setDialog({ mode: 'edit-current' })}>
            {t('common:actions.edit')}
          </Button>
        </>
      ),
      body: (
        <>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:connection.serverUrlValue', { url: settings.serverUrl.trim() || t('common:labels.notSet') })}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:connection.usernameValue', { username: settings.username.trim() || t('settings:connection.usernameEmpty') })}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:connection.notSavedYet')}</Text>
        </>
      ),
    }));
  }

  profiles.forEach((profile) => {
    const isActive = profile.id === activeProfile?.id;
    const isSwitching = switchingProfileId === profile.id;
    rows.push(renderRow({
      rowKey: profile.id,
      testIDKey: profile.id,
      name: profile.name,
      subtitle: connectionHost(profile.serverUrl),
      isActive,
      isSwitching,
      actions: isActive ? (
        <>
          <Button
            testID="connection-reconnect"
            mode="contained"
            loading={isReconnecting}
            disabled={isReconnecting || isSwitching}
            onPress={() => void connect()}>
            {t('common:actions.reconnect')}
          </Button>
          {profile.connect ? onManageConnect ? <Button mode="outlined" onPress={() => manageConnect(profile)}>{t('settings:connect.manage')}</Button> : null : <Button testID={`connection-edit-${profile.id}`} mode="outlined" onPress={() => void handleEditProfile(profile)}>
            {t('common:actions.edit')}
          </Button>}
        </>
      ) : (
        <>
          <Button
            testID={`connection-connect-${profile.id}`}
            mode="contained"
            loading={isSwitching}
            disabled={Boolean(switchingProfileId) || isSwitching}
            onPress={() => void handleConnect(profile)}>
            {t('common:actions.connect')}
          </Button>
          {profile.connect ? onManageConnect ? <Button mode="outlined" onPress={() => manageConnect(profile)}>{t('settings:connect.manage')}</Button> : null : <Button testID={`connection-edit-${profile.id}`} mode="outlined" onPress={() => void handleEditProfile(profile)}>
            {t('common:actions.edit')}
          </Button>}
          <Button testID={`connection-delete-${profile.id}`} mode="text" textColor={palette.danger} onPress={() => handleDelete(profile)}>
            {t('common:actions.delete')}
          </Button>
        </>
      ),
      body: (
        <>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:connection.serverUrlValue', { url: profile.serverUrl })}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:connection.usernameValue', { username: profile.username || t('settings:connection.usernameEmpty') })}</Text>
        </>
      ),
    }));
  });

  return (
    <>
      <View style={styles.list}>{rows}</View>
      <Button testID="connection-add-button" mode="outlined" icon="plus" onPress={() => setDialog({ mode: 'add' })}>
        {t('settings:connection.addConnection')}
      </Button>
      {profiles.length === 0 ? (
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          {t('settings:connection.addDescription')}
        </Text>
      ) : null}
      {dialog ? (
        <ConnectionProfileDialog
          title={dialog.mode === 'add' ? t('settings:connection.addConnection') : t('settings:connection.editConnection')}
          submitLabel={dialog.mode === 'add' ? t('settings:connection.saveAndConnect') : t('common:actions.save')}
          showName={dialog.mode !== 'edit-current'}
          initial={dialog.mode === 'add' ? undefined : dialog.mode === 'edit-current' ? {
            serverUrl: settings.serverUrl,
            username: settings.username,
            password: settings.password,
          } : {
            name: dialog.profile.name,
            serverUrl: dialog.profile.serverUrl,
            username: dialog.profile.username,
            password: dialog.password,
          }}
          onSubmit={handleDialogSubmit}
          onDismiss={() => setDialog(undefined)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingRight: 12,
    paddingVertical: 6,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowBody: {
    gap: 4,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
});
