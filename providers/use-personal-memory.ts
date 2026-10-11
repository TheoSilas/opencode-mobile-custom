import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { personalMemoryKey } from '@/lib/storage-keys';
import { cleanMemoryItems, emptyPersonalMemory, extractionPrompt, memoryInstruction, parseExtraction, parsePersonalMemory, type PersonalMemory } from './personal-memory';

export function usePersonalMemory(connectionScope: string) {
  const [snapshot, setSnapshot] = useState<{ scope: string; data: PersonalMemory }>();
  const [failedScope, setFailedScope] = useState<string>();
  const data = snapshot?.scope === connectionScope ? snapshot.data : emptyPersonalMemory;
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    const started = revision.current;
    void AsyncStorage.getItem(personalMemoryKey(connectionScope)).then((raw) => {
      if (active && revision.current === started) setSnapshot({ scope: connectionScope, data: parsePersonalMemory(raw) });
    }).catch(() => { if (active && revision.current === started) setSnapshot({ scope: connectionScope, data: emptyPersonalMemory }); });
    return () => { active = false; };
  }, [connectionScope]);

  const modify = useCallback((change: (current: PersonalMemory) => PersonalMemory) => {
    revision.current += 1;
    const key = personalMemoryKey(connectionScope);
    const pending = queue.current.then(async () => {
      const current = parsePersonalMemory(await AsyncStorage.getItem(key));
      const next = change(current);
      await AsyncStorage.setItem(key, JSON.stringify(next));
      setSnapshot({ scope: connectionScope, data: next });
    });
    queue.current = pending.catch(() => undefined);
    return pending;
  }, [connectionScope]);

  const setEnabled = useCallback((enabled: boolean) => modify((current) => ({ ...current, enabled })), [modify]);
  const save = useCallback((items: string[]) => modify((current) => ({ ...current, items: cleanMemoryItems(items) })), [modify]);
  const clear = useCallback(() => save([]), [save]);

  // Read storage at submit time: the settings screen need not have hydrated yet.
  const intro = useCallback(async () => {
    const current = parsePersonalMemory(await AsyncStorage.getItem(personalMemoryKey(connectionScope)));
    return current.enabled ? memoryInstruction(current.items) : '';
  }, [connectionScope]);

  const learn = useCallback(async (client: ScopedOpencodeClient, message: string, modelId?: string) => {
    if (!client.personalMemory?.extract || !message.trim()) return;
    const scope = connectionScope;
    const key = personalMemoryKey(scope);
    const current = parsePersonalMemory(await AsyncStorage.getItem(key));
    if (!current.enabled) return;
    const before = revision.current;
    let text: string;
    try {
      text = await client.personalMemory.extract(extractionPrompt(message, current.items), modelId);
      setFailedScope(undefined);
    } catch {
      setFailedScope(scope);
      return;
    }
    const result = parseExtraction(text);
    if (!result.length) return;
    const pending = queue.current.then(async () => {
      const latest = parsePersonalMemory(await AsyncStorage.getItem(key));
      // A manual edit, clear, or switch-off during extraction wins over the model.
      if (!latest.enabled || revision.current !== before) return;
      const next = { ...latest, items: cleanMemoryItems([...result, ...latest.items]) };
      await AsyncStorage.setItem(key, JSON.stringify(next));
      setSnapshot({ scope, data: next });
    });
    queue.current = pending.catch(() => undefined);
    await pending;
  }, [connectionScope]);

  return useMemo(() => ({ scope: connectionScope, ...data, extractionFailed: failedScope === connectionScope, setEnabled, save, clear, intro, learn }), [connectionScope, data, failedScope, setEnabled, save, clear, intro, learn]);
}
