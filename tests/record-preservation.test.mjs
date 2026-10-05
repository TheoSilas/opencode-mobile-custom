import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Stub the i18n alias so the data-URL import does not pull in the real i18n
// instance (expo-localization, bundled locale JSON).
const i18nStubUri = `data:text/javascript,${encodeURIComponent('export function getFormatLocale() { return "en"; }')}`;
const source = await readFile(new URL('../lib/opencode/format.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
  .outputText.replace(/from '@\/lib\/i18n'/g, `from "${i18nStubUri}"`);
const { mergeSessionMessageWindow, prependSessionMessageHistory, toTranscriptEntry } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

function record(id, text, error) {
  return {
    info: { id, role: 'assistant', sessionID: 'session-1', time: { created: Number(id.split('-')[1]) * 1000 }, ...(error ? { error } : {}) },
    parts: [{ type: 'text', text }],
  };
}

// 1. Identical tail fetch: array identity AND every record reference preserved.
const before = [record('m-1', 'first'), record('m-2', 'second')];
const identical = [record('m-1', 'first'), record('m-2', 'second')];
const sameMerge = mergeSessionMessageWindow(before, identical);
assert.equal(sameMerge, before, 'identical fetch must preserve array identity');
assert.equal(sameMerge[0], before[0]);
assert.equal(sameMerge[1], before[1]);

// 2. Changed parts: changed index adopts the new record, siblings keep refs.
const changedContent = [record('m-1', 'first'), record('m-2', 'second, now longer')];
const contentMerge = mergeSessionMessageWindow(before, changedContent);
assert.notEqual(contentMerge, before, 'changed content must break array identity');
assert.equal(contentMerge[0], before[0], 'unchanged sibling keeps its record ref');
assert.equal(contentMerge[1], changedContent[1]);
assert.equal(contentMerge[1].parts[0].text, 'second, now longer');

// 3. Changed info only (post-hoc error with identical parts): new record adopted.
const errored = [record('m-1', 'first'), record('m-2', 'second', 'stream failed')];
const errorMerge = mergeSessionMessageWindow(before, errored);
assert.notEqual(errorMerge, before);
assert.equal(errorMerge[0], before[0]);
assert.equal(errorMerge[1], errored[1], 'info-only change must adopt the new record');
assert.equal(errorMerge[1].info.error, 'stream failed');

// 4. Appended message: prior refs preserved, appended record present.
const appended = [...identical, record('m-3', 'third')];
const appendMerge = mergeSessionMessageWindow(before, appended);
assert.notEqual(appendMerge, before);
assert.equal(appendMerge[0], before[0]);
assert.equal(appendMerge[1], before[1]);
assert.equal(appendMerge[2].info.id, 'm-3');

// 5. Empty fetched page keeps the existing window untouched.
assert.equal(mergeSessionMessageWindow(before, []), before, 'empty tail page preserves identity');

// 6. Duplicate and unexpected IDs: prior refs preserved, genuinely new appended.
const duplicateAndNew = [record('m-1', 'first'), record('m-1', 'first'), record('m-9', 'unknown')];
const mixedMerge = mergeSessionMessageWindow(before, duplicateAndNew);
assert.notEqual(mixedMerge, before);
assert.equal(mixedMerge[0], before[0]);
assert.equal(mixedMerge[1], before[1]);
assert.equal(mixedMerge[2], duplicateAndNew[2], 'unexpected ID adopts the fetched record');

// 7. Empty previous: the fetched array is adopted as-is.
const emptyPrevious = [];
const fresh = [record('m-1', 'first')];
assert.equal(mergeSessionMessageWindow(emptyPrevious, fresh), fresh);

// 8. Prepend older history: unseen records go first, overlap is dropped.
const older = [record('m-0', 'older a'), record('m-1', 'first')];
const prepended = prependSessionMessageHistory(before, older);
assert.notEqual(prepended, before);
assert.deepEqual(prepended.map((entry) => entry.info.id), ['m-0', 'm-1', 'm-2']);
assert.equal(prepended[1], before[0], 'existing record keeps its ref');
assert.equal(prepended[0], older[0], 'older record adopted');
assert.equal(prependSessionMessageHistory(before, []), before, 'empty history page preserves identity');
assert.equal(prependSessionMessageHistory(before, [record('m-1', 'first')]), before, 'fully overlapping page preserves identity');

// 9. Transcript entry cache integration: a preserved record ref returns the
// exact same cached entry object, skipping re-tokenization.
const entryBefore = toTranscriptEntry(before[0]);
const entryAfterContentMerge = toTranscriptEntry(contentMerge[0]);
assert.equal(entryAfterContentMerge, entryBefore, 'preserved ref reuses the cached transcript entry');
const entryAfterErrorMerge = toTranscriptEntry(errorMerge[0]);
assert.equal(entryAfterErrorMerge, entryBefore);

// Bench mode (not a CI gate): `node tests/record-preservation.test.mjs --bench`
if (process.argv.includes('--bench')) {
  const size = 200;
  const iterations = 200;
  const base = Array.from({ length: size }, (_, index) => record(`m-${index}`, `content ${index}`));
  const oneChange = [...base.slice(0, size - 1), record(`m-${size - 1}`, 'changed')];

  for (const [label, next] of [['identical', base], ['one-change', oneChange]]) {
    const started = performance.now();
    for (let run = 0; run < iterations; run += 1) {
      mergeSessionMessageWindow(base, next);
    }
    const elapsed = (performance.now() - started) / iterations;
    console.log(`merge ${label}: ${elapsed.toFixed(3)} ms/iteration (${size} records)`);
  }
}

console.log('record preservation tests passed');
