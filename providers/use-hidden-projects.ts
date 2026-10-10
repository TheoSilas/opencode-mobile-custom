import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { hiddenProjectsKey } from '@/lib/storage-keys';

export function parseHiddenProjectPaths(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((path): path is string => typeof path === 'string' && path.startsWith('/') && path.length < 4096))].slice(0, 100) : [];
  } catch {
    return [];
  }
}

/** Only filters this app's catalog; it never removes server records or source. */
export function useHiddenProjects(connectionScope: string) {
  const [snapshot, setSnapshot] = useState<{ scope: string; paths: string[] }>();
  const paths = snapshot?.scope === connectionScope ? snapshot.paths : [];

  useEffect(() => {
    let current = true;
    void AsyncStorage.getItem(hiddenProjectsKey(connectionScope)).then((stored) => {
      if (!current) return;
      setSnapshot({ scope: connectionScope, paths: parseHiddenProjectPaths(stored) });
    }).catch(() => { if (current) setSnapshot({ scope: connectionScope, paths: [] }); });
    return () => { current = false; };
  }, [connectionScope]);

  const update = useCallback(async (path: string, hide: boolean) => {
    const key = hiddenProjectsKey(connectionScope);
    const stored = await AsyncStorage.getItem(key);
    const current = parseHiddenProjectPaths(stored);
    const next = hide ? [...new Set([...current, path])] : current.filter((entry) => entry !== path);
    await AsyncStorage.setItem(key, JSON.stringify(next));
    setSnapshot({ scope: connectionScope, paths: next });
  }, [connectionScope]);

  return { paths, hide: (path: string) => update(path, true), show: (path: string) => update(path, false) };
}
