import { describe, expect, it } from 'vitest';

import { cleanMemoryItems, extractionPrompt, memoryInstruction, parseExtraction, parsePersonalMemory } from '@/providers/personal-memory';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';

describe('personal memory', () => {
  it('accepts only bounded items and treats code or credentials as non-memory', () => {
    expect(parsePersonalMemory('{bad')).toEqual({ enabled: true, items: [] });
    expect(cleanMemoryItems(['I prefer short replies', 'i prefer short replies', 'password is 123', 'sk-abcdefghijklmnopqrstuvwxyz'])).toEqual(['I prefer short replies']);
    expect(parseExtraction('```json\n{"memories":["I speak Chinese"]}\n```')).toEqual(['I speak Chinese']);
    expect(parseExtraction('not json')).toEqual([]);
    expect(memoryInstruction(['I speak Chinese'])).toContain('I speak Chinese');
    expect(extractionPrompt('one-off question', [])).toContain('Do not infer facts from questions');
  });

  it('learns across projects on one server, isolates servers, and honors edits while extraction is pending', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
    };
    const runtime = hookRuntime();
    const { usePersonalMemory } = await loadTs('providers/use-personal-memory.ts', {
      react: runtime.react,
      '@react-native-async-storage/async-storage': storage,
      '@/lib/storage-keys': { personalMemoryKey: (server: string) => `personal:${server}` },
      './personal-memory': { cleanMemoryItems, emptyPersonalMemory: { enabled: true, items: [] }, extractionPrompt, memoryInstruction, parseExtraction, parsePersonalMemory },
    });
    runtime.mount(({ scope }: { scope: string }) => usePersonalMemory(scope), { scope: 'a' });
    await runtime.settle();
    const pending = deferred();
    const started = deferred();
    const client = { personalMemory: { extract: () => { started.resolve(); return pending.promise; } } } as never;
    const learning = runtime.value.learn(client, 'I prefer concise replies', 'openai/test');
    await started.promise;
    await runtime.value.save(['Call me Lin']);
    pending.resolve('{"memories":["I prefer concise replies"]}');
    await learning;
    runtime.flush();
    expect(await runtime.value.intro()).toContain('Call me Lin');
    expect(await runtime.value.intro()).not.toContain('concise replies');

    await runtime.value.learn({ personalMemory: { extract: async () => '{"memories":["I prefer concise replies"]}' } } as never, 'I prefer concise replies');
    runtime.flush();
    expect(await runtime.value.intro()).toContain('concise replies');
    runtime.update({ scope: 'b' });
    await runtime.settle();
    expect(await runtime.value.intro()).toBe('');
    runtime.update({ scope: 'a' });
    await runtime.settle();
    await runtime.value.setEnabled(false);
    runtime.flush();
    expect(await runtime.value.intro()).toBe('');
    let calls = 0;
    await runtime.value.learn({ personalMemory: { extract: async () => { calls += 1; return '{"memories":["New preference"]}'; } } } as never, 'New preference');
    expect(calls).toBe(0);
    await runtime.value.clear();
    await runtime.value.setEnabled(true);
    expect(await runtime.value.intro()).toBe('');
  });
});
