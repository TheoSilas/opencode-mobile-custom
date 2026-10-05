import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { loadTs } from './helpers/runtime.mjs';

const source = await readFile(new URL('../lib/opencode/v2-mappers.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { modelToV1, projectToV1, sessionToV1 } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

// Session usage fields must survive the V2 -> V1 mapping or the usage sheet
// cannot resolve a context limit (regression guard for PR #49).
const session = sessionToV1({
  id: 'ses_1',
  projectID: 'project-1',
  title: 'Chat',
  agent: 'build',
  model: { id: 'sonnet', providerID: 'anthropic' },
  cost: 0.42,
  tokens: { input: 1200, output: 240, reasoning: 10, cache: { read: 800, write: 100 } },
  time: { created: 1, updated: 2 },
});
assert.deepEqual(session.model, { id: 'sonnet', providerID: 'anthropic' });
assert.equal(session.agent, 'build');
assert.equal(session.cost, 0.42);
assert.deepEqual(session.tokens, { input: 1200, output: 240, reasoning: 10, cache: { read: 800, write: 100 } });
assert.equal(session.title, 'Chat');
assert.deepEqual(session.time, { created: 1, updated: 2 });

const minimalSession = sessionToV1({ id: 'ses_2', projectID: 'project-1', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, updated: 0 } });
assert.equal(minimalSession.title, '');
assert.equal(minimalSession.model, undefined);

assert.deepEqual(projectToV1({ id: 'project-1', canonical: '/workspace/demo', vcs: 'git', time: { created: 1, updated: 2 }, sandboxes: [] }), {
  id: 'project-1',
  worktree: '/workspace/demo',
  vcs: 'git',
  time: { created: 1, initialized: 2 },
});

function model(overrides = {}) {
  return {
    id: 'anthropic/sonnet',
    modelID: 'sonnet',
    providerID: 'anthropic',
    name: 'Sonnet',
    capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
    variants: [],
    time: { released: 0 },
    cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
    status: 'active',
    enabled: true,
    limit: { context: 200000, output: 8192 },
    ...overrides,
  };
}

const mapped = modelToV1(model({
  cost: [
    { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
    { tier: { type: 'context', size: 200000 }, input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 } },
  ],
  variants: [{ id: 'high', settings: { reasoningEffort: 'high' } }],
}));
assert.equal(mapped.id, 'sonnet');
assert.equal(mapped.capabilities.reasoning, true);
assert.equal(mapped.capabilities.attachment, true);
assert.equal(mapped.capabilities.toolcall, true);
assert.deepEqual(mapped.capabilities.input, { text: true, audio: false, image: true, video: false, pdf: false });
assert.deepEqual(mapped.limit, { context: 200000, output: 8192 });
assert.deepEqual(mapped.cost, {
  input: 3,
  output: 15,
  cache: { read: 0.3, write: 3.75 },
  tiers: [{ input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 }, tier: { type: 'context', size: 200000 } }],
});
assert.equal(mapped.status, 'active');

// No reasoning signal, no explicit base cost entry, empty cost list.
assert.equal(modelToV1(model()).capabilities.reasoning, false);
assert.equal(modelToV1(model({ variants: [{ id: 'fast', settings: { reasoning: false } }] })).capabilities.reasoning, false);
assert.equal(modelToV1(model({ cost: [], variants: [] })).cost.input, 0);
assert.equal(modelToV1(model({ cost: [{ tier: { type: 'context', size: 1000 }, input: 1, output: 2, cache: { read: 0, write: 0 } }] })).cost.input, 1);
assert.equal(modelToV1(model({ compatibility: { reasoningField: 'reasoning_content' } })).capabilities.reasoning, true);

console.log('v2 mapper tests passed');

// Exercise discovery and auth through the real adapter: a catalog's `auto`
// providers must remain addable until the server reports usable models or a
// connection. Environment methods must not masquerade as API-key login.
const providers = ['openai', 'opencode-go', 'env-provider', 'disabled'].map((id) => ({
  id, name: id, activation: id === 'disabled' ? 'disabled' : 'auto', integrationID: id,
}));
const integrations = providers.map(({ id }) => ({
  id, name: id, connections: id === 'env-provider' ? [{ type: 'env', name: 'API_KEY' }] : [],
  methods: [{ type: 'env', names: ['API_KEY'] }, { type: 'oauth', id: 'login', label: 'Sign in' }, { type: 'key', label: 'API key' }],
}));
let savedKey;
let removedCredential;
const api = {
  credential: { remove: async ({ credentialID }) => { removedCredential = credentialID; } },
  provider: { list: async () => ({ data: providers }) },
  model: { list: async () => ({ data: providers.map(({ id }) => model({ providerID: id, enabled: id === 'openai' || id === 'disabled' })) }), default: async () => ({ data: null }) },
  integration: {
    list: async () => ({ data: integrations }),
    connect: { key: async ({ integrationID, key }) => {
      savedKey = { integrationID, key };
      integrations.find((item) => item.id === integrationID).connections.push({ type: 'credential', id: 'credential-go', method: 'key' });
    } },
    oauth: { connect: async ({ methodID }) => {
      assert.equal(methodID, 'login', 'UI method indices must address the filtered methods');
      return { data: { attemptID: 'attempt', url: 'https://example.com/login', mode: 'code' } };
    } },
  },
};
const adapter = await loadTs('lib/opencode/v2-client.ts', {
  '@opencode/client': { OpenCode: { make: () => api } },
  './in-flight': await loadTs('lib/opencode/in-flight.ts'),
  './v2-mappers': await loadTs('lib/opencode/v2-mappers.ts'),
  './client': { getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }), getRequestHeaders: () => ({}), createPrefixFetch: () => () => {} },
});
const client = adapter.buildV2Client({ serverUrl: 'http://test', directory: '/repo', username: '', password: '' });
assert.deepEqual(Array.from((await client.provider.list()).data.connected), ['openai', 'env-provider']);
// Real V2 servers omit unconnected providers and their models entirely.
api.provider.list = async () => ({ data: providers.filter(({ id }) => id === 'openai') });
integrations.push({ id: 'mcp-tools', name: 'Tools', metadata: { source: 'mcp' }, connections: [], methods: [{ type: 'oauth', id: 'mcp-login' }] });
const catalog = (await client.provider.list()).data;
assert.ok(catalog.all.some((provider) => provider.id === 'opencode-go'), 'integration-only providers remain addable');
assert.ok(!catalog.all.some((provider) => provider.id === 'mcp-tools'), 'MCP integrations stay out of the AI provider picker');
assert.deepEqual(Array.from((await client.provider.auth()).data['opencode-go'], (method) => method.type), ['oauth', 'api']);
await client.provider.oauth.authorize({ providerID: 'opencode-go', method: 0 });
await client.auth.set({ providerID: 'opencode-go', auth: { type: 'api', key: 'test-go-key' } });
assert.deepEqual(savedKey, { integrationID: 'opencode-go', key: 'test-go-key' });
api.provider.list = async () => ({ data: providers });
assert.deepEqual(Array.from((await client.provider.list()).data.connected), ['openai', 'opencode-go', 'env-provider']);
providers.find(({ id }) => id === 'opencode-go').integrationID = 'openai';
integrations.find(({ id }) => id === 'openai').methods = [{ type: 'oauth', id: 'console-login', label: 'Console account' }];
assert.deepEqual(Array.from((await client.provider.auth()).data['opencode-go'], (method) => method.type), ['oauth', 'api'], 'direct key support remains available alongside shared OAuth');
await client.auth.set({ providerID: 'opencode-go', auth: { type: 'api', key: 'second-go-key' } });
assert.deepEqual(savedKey, { integrationID: 'opencode-go', key: 'second-go-key' }, 'Go API keys belong to Go even when OAuth is Console-managed');
await client.auth.remove({ providerID: 'opencode-go' });
assert.equal(removedCredential, 'credential-go', 'removing a Go key must not remove a shared Console credential');
console.log('v2 provider discovery and API-key auth regression tests passed');
