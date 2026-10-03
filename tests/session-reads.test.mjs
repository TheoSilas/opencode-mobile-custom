import assert from 'node:assert/strict';
import { loadTs, deferred } from './helpers/runtime.mjs';

const flights = await loadTs('lib/opencode/in-flight.ts');
const services = await loadTs('providers/services/session-service.ts', {
  '@/lib/opencode/in-flight': flights,
  '@/providers/services/require-data': await loadTs('providers/services/require-data.ts'),
});
const mappers = await loadTs('lib/opencode/v2-mappers.ts');
const history = Array.from({ length: 4300 }, (_, i) => ({ id: `m-${i}`, type: 'user', text: `Message ${i}`, time: { created: i } }));
let messageCalls = 0, listCalls = 0;
const api = {
  message: { async list({ sessionID, limit, cursor, order }) {
    assert.equal(sessionID, 's'); assert.equal(limit, 100);
    if (cursor) assert.equal(order, undefined, 'cursor pages cannot repeat order');
    else assert.equal(order, 'desc', 'fetch newest records before applying any cap');
    messageCalls++;
    const offset = cursor ? Number(cursor) : 0;
    const newest = [...history].reverse();
    return { data: newest.slice(offset, offset + limit), cursor: { next: offset + limit < newest.length ? String(offset + limit) : null } };
  } },
  session: {
    async list() { listCalls++; await Promise.resolve(); return { data: [{ id: 's', time: { created: 0, updated: 1 }, location: { directory: '/repo' } }] }; },
    async active() { return { s: {} }; },
    async diff({ messageID }) { assert.equal(messageID, 'm-4299'); return []; },
  },
};
const adapter = await loadTs('lib/opencode/v2-client.ts', {
  '@opencode/client': { OpenCode: { make: () => api } },
  './in-flight': flights, './v2-mappers': mappers,
  './client': { getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }), getRequestHeaders: () => ({}), createPrefixFetch: () => () => {} },
});
const client = adapter.buildV2Client({ serverUrl: 'http://test', directory: '/repo', username: '', password: '' });
const [messages] = await Promise.all([services.getSessionMessages(client, 's'), services.getSessionDiff(client, 's')]);
assert.equal(messageCalls, 5, 'combined refresh reads five pages once, not twice');
assert.equal(messages.length, 500);
assert.equal(messages[0].info.id, 'm-3800');
assert.equal(messages.at(-1).info.id, 'm-4299', 'latest message remains visible beyond the former 4,000 cap');
await services.listSessions(client);
assert.equal(listCalls, 1, 'V2 list and status share their outstanding session-list read');
await services.getSessionMessages(client, 's');
assert.equal(messageCalls, 10, 'settled reads are not cached');

// V1 returns chronological pages backwards through its header cursor.
const v1Client = { session: { async messages({ limit, before }) {
  const end = before ? Number(before) : history.length;
  const start = Math.max(0, end - limit);
  return { data: history.slice(start, end).map((m) => ({ info: { id: m.id, role: 'user' }, parts: [] })), response: { headers: new Headers(start ? { 'x-next-cursor': String(start) } : {}) } };
} } };
const v1 = await services.getSessionMessages(v1Client, 's');
assert.equal(v1.length, 500); assert.equal(v1[0].info.id, 'm-3800'); assert.equal(v1.at(-1).info.id, 'm-4299');

const old = {}, next = {}, slow = deferred();
let reads = 0;
const read = () => { reads++; return slow.promise; };
const a = flights.coalesceRead(old, 'messages:s', read), b = flights.coalesceRead(old, 'messages:s', read);
assert.equal(a, b);
const other = flights.coalesceRead(next, 'messages:s', read);
await Promise.resolve(); assert.equal(reads, 2, 'client scopes cannot share requests');
slow.resolve([]); await Promise.all([a, other]);
await assert.rejects(flights.coalesceRead(old, 'failure', async () => { throw new Error('offline'); }), /offline/);
assert.equal(await flights.coalesceRead(old, 'failure', async () => 'recovered'), 'recovered');
console.log('session read, pagination, coalescing, and scope regression tests passed');
