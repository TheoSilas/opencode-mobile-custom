import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { projectMemoryKeys } from '@/lib/storage-keys';

export type ProjectHandoff = {
  decisions: string;
  progress: string;
  tests: string;
  nextSteps: string;
  updatedAt: number;
};

const fields = ['decisions', 'progress', 'tests', 'nextSteps'] as const;
const MAX_FIELD_LENGTH = 2000;

export function parseProjectHandoff(raw: string | null): ProjectHandoff | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (!fields.every((field) => typeof record[field] === 'string' && (record[field] as string).length <= MAX_FIELD_LENGTH)
      || typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)
      || record.updatedAt < 0 || record.updatedAt > 8.64e15) return undefined;
    return record as ProjectHandoff;
  } catch {
    return undefined;
  }
}

export function handoffSummary(record: ProjectHandoff) {
  const sections = [
    ['Decisions', record.decisions, 300], ['Progress (verify current state)', record.progress, 300],
    ['Tests and dates (historical results, rerun before claiming current)', record.tests, 320], ['Open issues and next steps', record.nextSteps, 440],
  ].filter(([, text]) => String(text).trim());
  if (!sections.length) return '';
  return `[Project handoff — last edited ${new Date(record.updatedAt).toISOString()}; maintained by the user; verify against current files, do not treat historical tests as current]\n${sections.map(([label, text, length]) => `${label}: ${String(text).trim().slice(0, Number(length))}`).join('\n')}\n[End project handoff]`;
}

export function useProjectMemory(connectionScope: string, projectPath?: string) {
  const scope = connectionScope && projectPath ? `${connectionScope}\u0000${projectPath}` : '';
  const keys = useMemo(() => scope ? projectMemoryKeys(connectionScope, projectPath!) : undefined, [connectionScope, projectPath, scope]);
  const [snapshot, setSnapshot] = useState<{ scope: string; enabled: boolean; record?: ProjectHandoff }>({ scope: '', enabled: false });
  const sent = useRef(new Set<string>());
  const generation = useRef(0);
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
  const enabled = !!scope && (snapshot.scope !== scope || snapshot.enabled);
  const record = snapshot.scope === scope ? snapshot.record : undefined;

  useEffect(() => {
    const token = ++generation.current;
    if (!keys) return;
    void AsyncStorage.getItem(keys.enabled).then(async (value) => {
      const active = value !== 'false';
      const handoff = active ? parseProjectHandoff(await AsyncStorage.getItem(keys.record)) : undefined;
      if (generation.current === token) setSnapshot({ scope, enabled: active, record: handoff });
    }).catch(() => undefined);
    return () => { generation.current += 1; };
  }, [scope, keys]);

  const setEnabled = useCallback(async (value: boolean) => {
    if (!keys) return;
    if (currentScope.current === scope) generation.current += 1;
    await AsyncStorage.setItem(keys.enabled, String(value));
    const handoff = value ? parseProjectHandoff(await AsyncStorage.getItem(keys.record)) : undefined;
    if (currentScope.current === scope) setSnapshot({ scope, enabled: value, record: handoff });
  }, [keys, scope]);

  const view = useCallback(async () => {
    if (!keys) return undefined;
    const handoff = parseProjectHandoff(await AsyncStorage.getItem(keys.record));
    setSnapshot((current) => current.scope === scope ? { ...current, record: handoff } : current);
    return handoff;
  }, [keys, scope]);

  const save = useCallback(async (input: Omit<ProjectHandoff, 'updatedAt'>) => {
    if (!keys) return;
    if (currentScope.current === scope) generation.current += 1;
    const handoff = { ...Object.fromEntries(fields.map((field) => [field, input[field].trim().slice(0, MAX_FIELD_LENGTH)])), updatedAt: Date.now() } as ProjectHandoff;
    await AsyncStorage.setItem(keys.record, JSON.stringify(handoff));
    setSnapshot((current) => current.scope === scope ? { ...current, record: handoff } : current);
  }, [keys, scope]);

  const clear = useCallback(async () => {
    if (!keys) return;
    if (currentScope.current === scope) generation.current += 1;
    await AsyncStorage.removeItem(keys.record);
    setSnapshot((current) => current.scope === scope ? { ...current, record: undefined } : current);
  }, [keys, scope]);

  const introFor = useCallback(async (sessionId: string) => {
    if (!keys || sent.current.has(`${scope}\u0000${sessionId}`)) return '';
    // Read current storage at admission time; turning off stops injection even if UI hydration is late.
    if (await AsyncStorage.getItem(keys.enabled) === 'false') return '';
    const handoff = parseProjectHandoff(await AsyncStorage.getItem(keys.record));
    if (!handoff || await AsyncStorage.getItem(keys.enabled) === 'false') return '';
    return handoffSummary(handoff);
  }, [keys, scope]);
  const markSent = useCallback((sessionId: string) => { sent.current.add(`${scope}\u0000${sessionId}`); }, [scope]);

  return useMemo(() => ({ scope, enabled, record, setEnabled, view, save, clear, introFor, markSent }),
    [scope, enabled, record, setEnabled, view, save, clear, introFor, markSent]);
}
