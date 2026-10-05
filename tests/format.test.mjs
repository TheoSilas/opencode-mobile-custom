import assert from 'node:assert/strict';
import { loadTsModule, toDataUri } from './helpers/runtime.mjs';

// Stub the i18n alias so the loader does not pull in the real i18n instance
// (expo-localization, bundled locale JSON).
const i18nStubUri = toDataUri('export function getFormatLocale() { return "en"; }');
const { getMessagePreview, toTranscriptEntry, deriveTodosFromMessages } = await loadTsModule('lib/opencode/format.ts', {
  imports: { '@/lib/i18n': i18nStubUri },
});
const info = { id: 'message-1', role: 'assistant', sessionID: 'session-1', time: { created: 1 } };

assert.equal(getMessagePreview({ info, parts: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'Visible reply' }] }), 'Visible reply');

const failedTool = toTranscriptEntry({
  info,
  parts: [{ id: 'tool-1', type: 'tool', tool: 'build', state: { status: 'error', error: 'Build failed' } }],
});
assert.equal(failedTool.details[0].body, 'Build failed');

const toolAttachment = toTranscriptEntry({
  info,
  parts: [{ id: 'tool-2', type: 'tool', tool: 'capture', state: { status: 'completed', output: 'done', attachments: [{ type: 'file', mime: 'image/png', filename: 'result.png' }] } }],
});
assert.equal(toolAttachment.details[1].label, 'result.png');

const todoWritePart = (id, todos) => ({
  id,
  type: 'tool',
  tool: 'todowrite',
  state: { status: 'completed', input: { todos }, output: '', title: 'todowrite', metadata: {} },
});

assert.deepEqual(
  deriveTodosFromMessages([
    { info, parts: [todoWritePart('tool-todo-1', [
      { content: 'First task', status: 'completed', priority: 'high' },
      { content: 'Second task', status: 'in_progress', priority: 'low' },
    ])] },
  ]),
  [
    { content: 'First task', status: 'completed', priority: 'high' },
    { content: 'Second task', status: 'in_progress', priority: 'low' },
  ],
);

// The latest write wins, including a clearing write.
assert.deepEqual(
  deriveTodosFromMessages([
    { info, parts: [todoWritePart('tool-todo-2', [{ content: 'Stale', status: 'pending', priority: 'low' }])] },
    { info, parts: [todoWritePart('tool-todo-3', [])] },
  ]),
  [],
);

// Non-todo tools never contribute a plan.
assert.deepEqual(
  deriveTodosFromMessages([
    { info, parts: [{ id: 'tool-bash', type: 'tool', tool: 'bash', state: { status: 'completed', input: { todos: [{ content: 'Nope' }] } } }] },
  ]),
  [],
);

console.log('format tests passed');

const transcriptSource = await loadTsModule('lib/opencode/transcript.ts', {
  imports: { '@/lib/i18n': i18nStubUri },
});
const { getUserTurnForMessage } = transcriptSource;
const turnRecords = [
  { info: { id: 'user-a', role: 'user' }, parts: [] },
  { info: { id: 'reply-a', role: 'assistant', parentID: 'user-a' }, parts: [] },
  { info: { id: 'user-b', role: 'user' }, parts: [] },
  { info: { id: 'reply-b', role: 'assistant', parentID: 'user-b' }, parts: [] },
];
assert.equal(getUserTurnForMessage(turnRecords, 'reply-a'), 'user-a');
assert.equal(getUserTurnForMessage(turnRecords, 'reply-b'), 'user-b');
assert.equal(getUserTurnForMessage(turnRecords.slice(2), 'reply-a'), undefined);
assert.equal(getUserTurnForMessage([{ info: { id: 'orphan', role: 'assistant', parentID: 'missing' }, parts: [] }], 'orphan'), undefined);
