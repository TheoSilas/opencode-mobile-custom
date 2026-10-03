import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadTs, hookRuntime, deferred } from './helpers/runtime.mjs';

// Exercise the real provider file actions, including a server switch where
// the next server exposes the same directory as the previous server.
const provider = await readFile(new URL('../providers/opencode-provider.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('provider.tsx', provider, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'OpencodeProvider').body;
const names = ['searchWorkspaceFiles', 'openWorkspaceFile', 'saveWorkspaceFile', 'abortSession'];
const declarations = body.statements.filter((n) => ts.isVariableStatement(n) && names.includes(n.declarationList.declarations[0].name.getText(ast))).map((n) => n.getText(ast)).join('\n');
let aborted = false;
const client = { __opencode: { directory: '/repo' }, session: { abort: async () => { aborted = true; } } };
let active = client, files = [], selected, patches = 0;
const reads = new Map(), fileReads = new Map();
const fileGate = deferred(), saveGate = deferred();
const context = {
  client, useCallback: (fn) => fn, workspaceSearchRequestRef: { current: 0 }, workspaceFileRequestRef: { current: 0 },
  activeProjectPathRef: { current: '/repo' }, isCurrentClient: (candidate) => candidate === active,
  currentSessionIdRef: {}, diffScopeBySessionRef: { current: {} },
  findFiles: (_, query) => { const gate = deferred(); reads.set(query, gate); return gate.promise; },
  readFile: (_, path) => {
    if (path.startsWith('selection-')) { const gate = deferred(); fileReads.set(path, gate); return gate.promise; }
    return path === 'save' ? saveGate.promise : fileGate.promise;
  },
  setWorkspaceFiles: (value) => { files = value; }, setSelectedWorkspaceFile: (value) => { selected = value; },
  createFullFilePatch: () => 'patch', applyVcsPatch: async () => { patches++; }, refreshServerFeatures: async () => {}, refreshVcsDiff: async () => {},
  connectionScope: 'scope', pendingNotificationKey: () => 'key', pendingNotificationsRef: { current: new Map() },
  busyNotificationsRef: { current: new Set() }, promptSubmissionRef: { current: {} }, setSendingState: () => {},
  clearPendingTaskFinishedNotification: async () => { throw new Error('storage unavailable'); },
  refreshSessions: async () => {}, refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
  exports: {},
};
runInNewContext(ts.transpileModule(`${declarations}\nexports.actions = { ${names.join(', ')} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const actions = context.exports.actions;
const first = actions.searchWorkspaceFiles('first'), last = actions.searchWorkspaceFiles('last');
reads.get('last').resolve(['last.ts']); await last;
reads.get('first').resolve(['first.ts']); await first;
assert.deepEqual(files, ['last.ts'], 'older searches cannot replace newer results');
const olderFile = actions.openWorkspaceFile('selection-first'), newerFile = actions.openWorkspaceFile('selection-last');
fileReads.get('selection-last').resolve({ type: 'text', content: 'latest selection' }); await newerFile;
fileReads.get('selection-first').resolve({ type: 'text', content: 'obsolete selection' });
await assert.rejects(olderFile, /superseded/);
assert.equal(selected.path, 'selection-last');
const staleSearch = actions.searchWorkspaceFiles('old-server');
const staleFile = actions.openWorkspaceFile('old-server');
const staleSave = actions.saveWorkspaceFile('save', 'original', 'edited');
active = { __opencode: { directory: '/repo' } };
reads.get('old-server').resolve(['wrong-server.ts']); fileGate.resolve({ type: 'text', content: 'wrong server' }); saveGate.resolve({ type: 'text', content: 'original' });
await staleSearch;
await assert.rejects(staleFile, /superseded/); await assert.rejects(staleSave, /workspace changed/);
assert.deepEqual(files, ['last.ts']); assert.equal(selected.path, 'selection-last'); assert.equal(patches, 0);

await actions.abortSession('s');
assert.equal(aborted, true, 'notification storage failure must not prevent aborting server work');

// Real realtime hook: connected busy polling, reconnect reconciliation,
// backpressure, stable subscriptions, and cancellation of reconnect timers.
const runtime = hookRuntime();
let events = [], wake, subscriptions = 0, sessionsRefreshed = 0, pendingRefreshed = 0;
let heldRefresh;
const catalogClient = { global: { async event({ signal }) {
  subscriptions++;
  return { stream: (async function* () {
    while (!signal.aborted) {
      const incoming = await new Promise((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
      if (!incoming) return;
      yield incoming;
    }
  })() };
} } };
const realtime = await loadTs('providers/use-opencode-realtime.ts', { react: runtime.react }, runtime.globals);
assert.equal(realtime.shouldPoll(true, false), false);
assert.equal(realtime.shouldPoll(true, true), true);
assert.equal(realtime.shouldPoll(false, false), true);
const inputs = {
  catalogClient, activeProjectPath: '/repo', connected: true, busy: false, currentSessionId: 's',
  onEvent: (event) => events.push(event.type),
  refreshSessions: async () => { sessionsRefreshed++; await heldRefresh?.promise; },
  refreshPendingInteractions: async () => { pendingRefreshed++; },
  refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
};
runtime.mount(realtime.useOpencodeRealtime, inputs); await runtime.settle();
wake({ directory: '/repo', payload: { type: 'server.connected', properties: {} } }); await runtime.settle();
assert.equal(runtime.value.eventStreamStatus, 'connected'); assert.equal(sessionsRefreshed, 1); assert.equal(pendingRefreshed, 1);
assert.equal(runtime.countTimers(5000), 0, 'idle connected SSE needs no safety poll');
runtime.update({ busy: true }); runtime.fire(5000); await runtime.settle(); assert.equal(sessionsRefreshed, 2);
heldRefresh = deferred(); runtime.fire(5000); await runtime.settle(); runtime.fire(5000); await runtime.settle();
assert.equal(sessionsRefreshed, 3, 'slow reconciliation cannot overlap with another tick');
heldRefresh.resolve(); heldRefresh = undefined; await runtime.settle();
runtime.update({ refreshMessages: async () => {} }); await runtime.settle(); assert.equal(subscriptions, 1, 'changing action identities must not reopen SSE');
wake(null); await runtime.settle(); assert.equal(runtime.value.eventStreamStatus, 'error');
runtime.fire(1000); await runtime.settle(); assert.equal(subscriptions, 2);
wake({ directory: '/another-project', payload: { type: 'server.connected', properties: {} } }); await runtime.settle();
assert.equal(sessionsRefreshed, 4); assert.equal(pendingRefreshed, 4, 'reconnection always recovers pending interactions');
assert.deepEqual(events, ['server.connected'], 'other-project events are filtered');
wake(null); await runtime.settle(); runtime.unmount(); assert.equal(runtime.countTimers(1000), 0);

// Conversation state machine runs against stubbed speech/platform boundaries.
const voiceRuntime = hookRuntime();
let recognitionOptions, speechCallbacks, sends = 0, aborts = 0;
let listening = false;
const sendGate = deferred();
const startSpeech = async () => { listening = true; return true; };
const abortSpeech = () => { listening = false; aborts++; };
const selectors = await loadTs('providers/opencode-provider-selectors.ts', {
  '@/lib/opencode/format': { toTranscriptEntry: (record) => record, getHistoryPreview: () => '' },
  '@/lib/opencode/transcript': { isTranscriptDisplayMessage: (entry) => Boolean(entry.text), getTranscriptActivityLabel: () => undefined },
});
const conversation = await loadTs('providers/use-conversation-state.ts', {
  react: voiceRuntime.react,
  'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
  '@/lib/opencode/format': { toTranscriptEntry: (record) => record },
  '@/lib/opencode/transcript': { isTranscriptDisplayMessage: (entry) => Boolean(entry.text) },
  '@/lib/voice/speech-output': { stopSpeaking: async () => {}, speakText: async (options) => { speechCallbacks = options; options.onStart(); return true; } },
  '@/lib/voice/use-speech-input': { useSpeechInput: (options) => { recognitionOptions = options; return { abort: abortSpeech, start: startSpeech, isListening: listening, isStarting: false, level: 0 }; } },
  '@/lib/voice/working-sound': { stopWorkingSoundAsync: async () => {} },
  '@/providers/opencode-provider-selectors': selectors,
  '@/providers/opencode-provider-types': { CONVERSATION_FINAL_RESULT_SETTLE_MS: 2200, CONVERSATION_KEEP_AWAKE_TAG: 'test', CONVERSATION_LISTENING_RESTART_MS: 350 },
  '@/providers/use-conversation-keep-awake': { useConversationKeepAwake: () => {} },
  '@/providers/use-conversation-screen-dim': { useConversationScreenDim: () => {} },
}, voiceRuntime.globals);
const chatPreferences = (await loadTs('providers/opencode-preferences.ts')).defaultChatPreferences;
voiceRuntime.mount(conversation.useConversationState, {
  connection: { status: 'connected', message: 'ready' }, chatPreferences, currentSessionId: 's', setCurrentSessionId: () => {},
  sessionStatuses: { s: { type: 'busy' } }, messagesBySession: {}, pendingPermissionsBySession: {}, pendingQuestionsBySession: {},
  sendingState: { active: false }, ensureActiveSession: async () => 's', sendPrompt: async () => { sends++; await sendGate.promise; return true; },
});
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.phase, 'listening');
recognitionOptions.onResult('voice prompt', true); voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 1);
voiceRuntime.update({ messagesBySession: { s: [] }, sendPrompt: async () => { sends++; return true; } }); await voiceRuntime.settle();
assert.equal(sends, 1, 'a provider refresh cannot replay a submitted voice turn');
sendGate.resolve(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'waiting');
voiceRuntime.update({ sessionStatuses: { s: { type: 'idle' } }, messagesBySession: { s: [{ id: 'reply', role: 'assistant', text: 'done', details: [] }] } });
await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'speaking');
speechCallbacks.onDone(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'listening');
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'off');
voiceRuntime.update({ pendingQuestionsBySession: { s: [{ id: 'question' }] } });
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'off');
assert.match(voiceRuntime.value.conversation.feedback, /Answer the current request/);
voiceRuntime.unmount(); assert.equal(voiceRuntime.countTimers(2200), 0); assert.ok(aborts > 0);
console.log('workspace scope, realtime recovery, and conversation lifecycle regression tests passed');

// Profile orchestration stays provider-owned and serializes metadata/credentials.
const profileRuntime = hookRuntime();
let storedProfiles = [], profileId = 0, failMetadata = false, updates = 0;
const passwords = new Map();
const profilesHook = await loadTs('providers/use-connection-profiles.ts', {
  react: profileRuntime.react,
  '@/lib/connection-profiles': {
    createProfileId: () => `profile-${++profileId}`,
    loadConnectionProfiles: async () => [...storedProfiles],
    saveConnectionProfiles: async (next) => { if (failMetadata) throw new Error('metadata failed'); storedProfiles = next; },
    getProfilePassword: async (id) => passwords.get(id) ?? '',
    saveProfilePassword: async (id, password) => { passwords.set(id, password); },
    deleteProfilePassword: async (id) => { passwords.delete(id); },
    findMatchingProfile: (entries, settings) => entries.find((p) => p.serverUrl === settings.serverUrl),
  },
});
profileRuntime.mount(profilesHook.useConnectionProfiles, {
  settings: { serverUrl: 'current' }, switchConnection: async () => {}, updateSettings: () => { updates++; },
});
const [savedA, savedB] = await Promise.all([
  profileRuntime.value.save({ name: 'A', serverUrl: 'a', username: 'alice', password: 'a-secret' }),
  profileRuntime.value.save({ name: 'B', serverUrl: 'b', username: 'bob', password: 'b-secret' }),
]);
await profileRuntime.settle();
assert.equal(storedProfiles.length, 2); assert.equal(updates, 0, 'saving a new inactive profile cannot change the active settings');
failMetadata = true;
await assert.rejects(profileRuntime.value.save({ name: 'edited', serverUrl: 'a', username: 'alice', password: 'new-secret' }, savedA.id), /metadata failed/);
assert.equal(passwords.get(savedA.id), 'a-secret', 'failed metadata writes restore the previous credential');
failMetadata = false;
profileRuntime.update({ settings: { serverUrl: 'a' } });
await assert.rejects(profileRuntime.value.remove(savedA.id), /active connection/);
await profileRuntime.value.remove(savedB.id); await profileRuntime.settle();
assert.equal(storedProfiles.length, 1); assert.equal(passwords.has(savedB.id), false);
const stableProfiles = profileRuntime.value;
profileRuntime.update({ switchConnection: async () => {} });
assert.equal(profileRuntime.value, stableProfiles, 'profile domain values remain stable when only callback bridges change');
profileRuntime.unmount();
console.log('provider-owned profile ordering, rollback, and callback stability checks passed');
