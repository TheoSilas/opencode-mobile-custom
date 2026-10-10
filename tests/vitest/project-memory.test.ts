import { describe, expect, it } from 'vitest';

import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';

describe('project handoff admission', () => {
  it('does not let late hydration turn an explicitly disabled project back on', async () => {
    const pending = deferred();
    const storage = { getItem: async (key: string) => key.startsWith('on:') ? pending.promise : null, setItem: async () => undefined, removeItem: async () => undefined };
    const runtime = hookRuntime();
    const { useProjectMemory } = await loadTs('providers/use-project-memory.ts', {
      react: runtime.react,
      '@react-native-async-storage/async-storage': storage,
      '@/lib/storage-keys': { projectMemoryKeys: () => ({ enabled: 'on:a', record: 'record:a' }) },
    });
    runtime.mount(({ connectionScope, projectPath }: { connectionScope: string; projectPath: string }) => useProjectMemory(connectionScope, projectPath), { connectionScope: 'a', projectPath: '/a' });
    await runtime.value.setEnabled(false);
    runtime.flush();
    pending.resolve('true');
    await runtime.settle();
    expect(runtime.value.enabled).toBe(false);
  });

  it('isolates server and directory, includes once, preserves a disabled record, and never revives it when disabled', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const runtime = hookRuntime();
    const { useProjectMemory, handoffSummary } = await loadTs('providers/use-project-memory.ts', {
      react: runtime.react,
      '@react-native-async-storage/async-storage': storage,
      '@/lib/storage-keys': { projectMemoryKeys: (server: string, project: string) => ({ enabled: `on:${server}:${project}`, record: `record:${server}:${project}` }) },
    });
    runtime.mount(({ connectionScope, projectPath }: { connectionScope: string; projectPath: string }) => useProjectMemory(connectionScope, projectPath), { connectionScope: 'server-a', projectPath: '/project-a' });
    await runtime.settle();
    await runtime.value.save({ decisions: 'Use API', progress: 'Updated code', tests: '2026-10-10: typecheck passed', nextSteps: 'Check device' });
    runtime.flush();
    expect([...values.keys()]).toContain('record:server-a:/project-a');
    expect((await runtime.value.view())?.nextSteps).toBe('Check device');
    expect(await runtime.value.introFor('session-1')).toContain('Check device');
    expect(handoffSummary({ decisions: 'x'.repeat(2000), progress: 'y'.repeat(2000), tests: 'dated result', nextSteps: 'Unresolved bug', updatedAt: 1 })).toContain('Unresolved bug');
    runtime.value.markSent('session-1');
    expect(await runtime.value.introFor('session-1')).toBe('');
    await runtime.value.setEnabled(false);
    runtime.flush();
    expect(await runtime.value.introFor('session-2')).toBe('');
    expect((await runtime.value.view())?.decisions).toBe('Use API');
    runtime.update({ projectPath: '/project-b' });
    await runtime.settle();
    expect(await runtime.value.introFor('session-2')).toBe('');
    runtime.update({ projectPath: '/project-a', connectionScope: 'server-b' });
    await runtime.settle();
    expect(await runtime.value.introFor('session-2')).toBe('');
    runtime.update({ projectPath: '/project-a', connectionScope: 'server-a' });
    await runtime.settle();
    expect(runtime.value.enabled).toBe(false);
    expect(await runtime.value.introFor('session-3')).toBe('');
    await runtime.value.setEnabled(true);
    expect(await runtime.value.introFor('session-3')).toContain('Use API');
    expect(await runtime.value.introFor('session-1')).toBe('');
  });
});
