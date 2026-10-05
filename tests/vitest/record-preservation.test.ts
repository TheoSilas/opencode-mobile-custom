import { describe, it, expect, vi } from 'vitest';

import { mergeSessionMessageWindow, prependSessionMessageHistory, toTranscriptEntry } from '@/lib/opencode/format';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

function record(id: string, text: string, error?: string) {
  return {
    info: { id, role: 'assistant', sessionID: 'session-1', time: { created: Number(id.split('-')[1]) * 1000 }, ...(error ? { error } : {}) },
    parts: [{ type: 'text', text }],
  } as never;
}

const before = [record('m-1', 'first'), record('m-2', 'second')];

describe('mergeSessionMessageWindow', () => {
  it('preserves array and record identity for an identical tail fetch', () => {
    const identical = [record('m-1', 'first'), record('m-2', 'second')];
    const sameMerge = mergeSessionMessageWindow(before, identical);
    expect(sameMerge).toBe(before);
    expect(sameMerge[0]).toBe(before[0]);
    expect(sameMerge[1]).toBe(before[1]);
  });

  it('adopts a changed record while preserving unchanged siblings', () => {
    const changedContent = [record('m-1', 'first'), record('m-2', 'second, now longer')];
    const contentMerge = mergeSessionMessageWindow(before, changedContent);
    expect(contentMerge).not.toBe(before);
    expect(contentMerge[0]).toBe(before[0]);
    expect(contentMerge[1]).toBe(changedContent[1]);
    expect((contentMerge[1] as never as { parts: { text: string }[] }).parts[0].text).toBe('second, now longer');
  });

  it('adopts a record whose info changed but parts did not', () => {
    const errored = [record('m-1', 'first'), record('m-2', 'second', 'stream failed')];
    const errorMerge = mergeSessionMessageWindow(before, errored);
    expect(errorMerge).not.toBe(before);
    expect(errorMerge[0]).toBe(before[0]);
    expect(errorMerge[1]).toBe(errored[1]);
    expect((errorMerge[1] as never as { info: { error: string } }).info.error).toBe('stream failed');
  });

  it('appends new records and preserves prior refs', () => {
    const appended = [record('m-1', 'first'), record('m-2', 'second'), record('m-3', 'third')];
    const appendMerge = mergeSessionMessageWindow(before, appended);
    expect(appendMerge).not.toBe(before);
    expect(appendMerge[0]).toBe(before[0]);
    expect(appendMerge[1]).toBe(before[1]);
    expect((appendMerge[2] as never as { info: { id: string } }).info.id).toBe('m-3');
  });

  it('keeps the existing window untouched for an empty tail page', () => {
    expect(mergeSessionMessageWindow(before, [])).toBe(before);
  });

  it('handles duplicate and unexpected IDs', () => {
    const duplicateAndNew = [record('m-1', 'first'), record('m-1', 'first'), record('m-9', 'unknown')];
    const mixedMerge = mergeSessionMessageWindow(before, duplicateAndNew);
    expect(mixedMerge).not.toBe(before);
    expect(mixedMerge[0]).toBe(before[0]);
    expect(mixedMerge[1]).toBe(before[1]);
    expect(mixedMerge[2]).toBe(duplicateAndNew[2]);
  });

  it('adopts the fetched array when the previous window is empty', () => {
    const fresh = [record('m-1', 'first')];
    expect(mergeSessionMessageWindow([], fresh)).toBe(fresh);
  });
});

describe('prependSessionMessageHistory', () => {
  it('puts unseen older records first and drops overlap', () => {
    const older = [record('m-0', 'older a'), record('m-1', 'first')];
    const prepended = prependSessionMessageHistory(before, older);
    expect(prepended).not.toBe(before);
    expect(prepended.map((entry) => (entry as never as { info: { id: string } }).info.id)).toEqual(['m-0', 'm-1', 'm-2']);
    expect(prepended[1]).toBe(before[0]);
    expect(prepended[0]).toBe(older[0]);
  });

  it('preserves identity for empty or fully overlapping pages', () => {
    expect(prependSessionMessageHistory(before, [])).toBe(before);
    expect(prependSessionMessageHistory(before, [record('m-1', 'first')])).toBe(before);
  });
});

describe('transcript entry cache', () => {
  it('reuses the cached entry for a preserved record ref', () => {
    const entryBefore = toTranscriptEntry(before[0]);
    const identical = [record('m-1', 'first'), record('m-2', 'second')];
    const sameMerge = mergeSessionMessageWindow(before, identical);
    expect(toTranscriptEntry(sameMerge[0])).toBe(entryBefore);
  });
});
