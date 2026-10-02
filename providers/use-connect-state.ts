import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import {
  claimConnectPairing, getConnectControlPlanes, getConnectCredentialError, getConnectUserToken,
  isConnectEnabled, listConnectMachines, parseConnectPairing, revokeConnectMachine,
  type ConnectClaim, type ConnectMachine, type ConnectPairing,
} from '@/lib/connect';
import { deleteProfilePassword, getProfilePassword, loadConnectionProfiles, saveConnectProfile, saveConnectionProfiles, type ConnectionProfile } from '@/lib/connection-profiles';
import type { ConnectionContextValue } from '@/providers/opencode-provider-types';

export function useConnectState({ switchConnection, disconnect }: {
  switchConnection: ConnectionContextValue['switchConnection'];
  disconnect: (profile: ConnectionProfile) => Promise<void>;
}) {
  const enabled = isConnectEnabled();
  const [controlPlaneUrl, setControlPlaneUrl] = useState(() => getConnectControlPlanes()[0] ?? '');
  const [hasToken, setHasToken] = useState(false);
  const [pairing, setPairing] = useState<ConnectPairing>();
  const [phase, setPhase] = useState<'idle' | 'claiming' | 'saving' | 'connecting' | 'paired'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [machines, setMachines] = useState<ConnectMachine[]>();
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [usableProfileIds, setUsableProfileIds] = useState<string[]>([]);
  const [savedProfile, setSavedProfile] = useState<ConnectionProfile>();
  const tokenRef = useRef('');
  const lock = useRef(false);
  const pendingClaim = useRef<{ controlPlaneUrl: string; response: ConnectClaim } | undefined>(undefined);
  const scopeGeneration = useRef(0);

  useEffect(() => {
    const generation = ++scopeGeneration.current;
    tokenRef.current = '';
    if (!enabled || !controlPlaneUrl) return;
    void Promise.all([getConnectUserToken(controlPlaneUrl), loadConnectionProfiles()]).then(([token, stored]) => {
      if (scopeGeneration.current !== generation) return;
      tokenRef.current = token;
      setHasToken(Boolean(token));
      setProfiles(stored);
    }).catch(() => { if (scopeGeneration.current === generation) setError('Could not prepare secure storage. Restart the development app and try again.'); });
    return () => { scopeGeneration.current += 1; };
  }, [controlPlaneUrl, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const usable = await Promise.all(profiles.filter((profile) => profile.connect).map(async (profile) => {
        try { return getConnectCredentialError(profile.connect, await getProfilePassword(profile.id)) ? undefined : profile.id; }
        catch { return undefined; }
      }));
      if (!active) return;
      setUsableProfileIds(usable.filter((id): id is string => Boolean(id)));
      const remaining = profiles.map((profile) => Date.parse(profile.connect?.expiresAt ?? '') - Date.now()).filter((delay) => delay > 0);
      clearTimeout(timer);
      if (remaining.length) timer = setTimeout(() => { void check(); }, Math.min(...remaining, 2_147_483_647));
    };
    void check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => { active = false; clearTimeout(timer); subscription.remove(); };
  }, [enabled, profiles]);

  const perform = useCallback(async (action: () => Promise<boolean | void>) => {
    if (!enabled || lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try { return (await action()) !== false; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Connect setup failed. Try again.'); return false; }
    finally { lock.current = false; setBusy(false); }
  }, [enabled]);

  const selectControlPlane = useCallback((url: string) => {
    if (lock.current || pendingClaim.current || url === controlPlaneUrl || !getConnectControlPlanes().includes(url)) return;
    setControlPlaneUrl(url);
    setHasToken(false);
    setPairing(undefined);
    setMachines(undefined);
    setSavedProfile(undefined);
    setPhase('idle');
    setError(undefined);
    setNotice(undefined);
  }, [controlPlaneUrl]);

  const acceptLink = useCallback((link: Parameters<typeof parseConnectPairing>[0]) => {
    if (lock.current) return false;
    if (pendingClaim.current) { setError('Finish saving the claimed connection before opening another pairing.'); return false; }
    try {
      const next = parseConnectPairing(link);
      if (next.controlPlaneUrl !== controlPlaneUrl) {
        tokenRef.current = '';
        setHasToken(false);
        setMachines(undefined);
        setControlPlaneUrl(next.controlPlaneUrl);
      }
      setPairing(next);
      setSavedProfile(undefined);
      setPhase('idle');
      setError(undefined);
      setNotice(undefined);
      return true;
    } catch (reason) { setError((reason as Error).message); return false; }
  }, [controlPlaneUrl]);

  const activate = useCallback(async (profile: ConnectionProfile) => {
    const password = await getProfilePassword(profile.id);
    const credentialError = getConnectCredentialError(profile.connect, password);
    if (credentialError) throw new Error(credentialError);
    setSavedProfile(profile);
    setPhase('connecting');
    const result = await switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password, connect: profile.connect }, profile.modelPreferences);
    setPhase('paired');
    if (result.status !== 'connected') throw new Error(result.message);
    return true;
  }, [switchConnection]);

  const claim = useCallback(() => perform(async () => {
    if (!pairing) throw new Error('Scan or open a pairing link first.');
    if (!pendingClaim.current) {
      setPhase('claiming');
      const deviceName = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Web test device';
      const response = await claimConnectPairing(pairing, tokenRef.current, deviceName);
      pendingClaim.current = { controlPlaneUrl: pairing.controlPlaneUrl, response };
    }
    setPhase('saving');
    let profile: ConnectionProfile;
    try { profile = await saveConnectProfile(pendingClaim.current.controlPlaneUrl, pendingClaim.current.response); }
    catch { throw new Error('Pairing succeeded, but secure saving failed. Retry saving without claiming again; do not close the app.'); }
    pendingClaim.current = undefined;
    setPairing(undefined);
    setProfiles(await loadConnectionProfiles());
    return activate(profile);
  }), [activate, pairing, perform]);

  const refreshMachines = useCallback(() => perform(async () => {
    const [next, stored] = await Promise.all([listConnectMachines(controlPlaneUrl, tokenRef.current), loadConnectionProfiles()]);
    setMachines(next);
    setProfiles(stored);
  }), [controlPlaneUrl, perform]);

  const connectProfile = useCallback((profile: ConnectionProfile) => perform(() => activate(profile)), [activate, perform]);
  const removeProfiles = useCallback(async (removed: ConnectionProfile[]) => {
    // Disconnect before removing metadata so background resolution cannot fall
    // back to an active credential after the saved profile has gone.
    for (const profile of removed) await disconnect(profile);
    const stored = await loadConnectionProfiles(true);
    const next = stored.filter((profile) => !removed.some((item) => item.id === profile.id));
    await saveConnectionProfiles(next);
    await Promise.all(removed.map((profile) => deleteProfilePassword(profile.id)));
    setProfiles(next);
    if (removed.some((profile) => profile.id === savedProfile?.id)) { setSavedProfile(undefined); setPhase('idle'); }
  }, [disconnect, savedProfile?.id]);

  const forgetProfile = useCallback((profile: ConnectionProfile) => perform(async () => {
    await removeProfiles([profile]);
    setNotice('Connection forgotten on this device. The machine is still available to other devices.');
  }), [perform, removeProfiles]);
  const revokeMachine = useCallback((id: string) => perform(async () => {
    await revokeConnectMachine(controlPlaneUrl, id, tokenRef.current);
    const stored = await loadConnectionProfiles(true);
    await removeProfiles(stored.filter((profile) => profile.connect?.controlPlaneUrl === controlPlaneUrl && profile.connect.machineId === id));
    setMachines((current) => current?.filter((machine) => machine.id !== id));
    setNotice('Machine deletion acknowledged; local credentials removed. Remote tunnel cleanup is not guaranteed by the current backend.');
  }), [controlPlaneUrl, perform, removeProfiles]);

  return { enabled, controlPlaneUrl, hasToken, pairing, phase, busy, error, notice, machines, profiles, usableProfileIds, savedProfile,
    selectControlPlane, acceptLink, claim, refreshMachines, connectProfile, forgetProfile, revokeMachine };
}

export type ConnectSetup = ReturnType<typeof useConnectState>;
