import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const uri = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
async function moduleUri(file, replacements) {
  let code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const [pattern, replacement] of replacements) code = code.replace(pattern, replacement);
  return uri(code);
}
globalThis.__connectConfig = { extra: { connectPilot: { enabled: true, controlPlanes: ['https://api.getopencode.app', 'http://127.0.0.1:8787'] } } };
globalThis.__connectPlatform = 'ios';
globalThis.__connectSecrets = new Map();
const constants = uri('export default { get expoConfig() { return globalThis.__connectConfig; } };');
const native = uri('export const Platform = { get OS() { return globalThis.__connectPlatform; } };');
const secure = uri(`export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 1;
  export async function getItemAsync(key) { return globalThis.__connectSecrets.get(key) ?? null; }
  export async function setItemAsync(key, value) { globalThis.__connectSecrets.set(key, value); }
  export async function deleteItemAsync(key) { globalThis.__connectSecrets.delete(key); }`);
const connect = await import(await moduleUri('../lib/connect.ts', [
  [/from 'expo\/fetch'/g, `from "${uri('export const fetch = (...args) => globalThis.fetch(...args);')}"`],
  [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`], [/from 'expo-secure-store'/g, `from "${secure}"`],
]));
const url = new URL('opencodemobile://pair');
for (const [key, value] of Object.entries({ v: '1', cp: 'https://api.getopencode.app', id: 'pair-1', t: 'temporary-token', n: 'Mac & Studio' })) url.searchParams.set(key, value);
const pairing = connect.parseConnectPairing(url.toString());
assert.deepEqual(connect.getConnectControlPlanes(), ['https://api.getopencode.app'], 'Extra configuration cannot trust another control plane.');
assert.equal(pairing.machineName, 'Mac & Studio');
assert.equal(pairing.pairingToken, 'temporary-token');
assert.deepEqual(connect.parseConnectPairing(Object.fromEntries(url.searchParams)), pairing);
for (const field of ['v', 'cp', 'id', 't', 'n']) {
  const missing = new URL(url); missing.searchParams.delete(field);
  assert.throws(() => connect.parseConnectPairing(missing.toString()), /Invalid/);
}
for (const [field, value] of [['v', '2'], ['id', '../other'], ['cp', 'https://attacker.test'], ['cp', 'https://api.getopencode.app@attacker.test'], ['cp', 'http://api.getopencode.app'], ['cp', 'http://127.0.0.1:8787']]) {
  const bad = new URL(url); bad.searchParams.set(field, value);
  assert.throws(() => connect.parseConnectPairing(bad.toString()));
}
assert.throws(() => connect.parseConnectPairing(`${url}&id=duplicate`));
assert.throws(() => connect.parseConnectPairing(url.toString().replace('://pair?', '://other?')));
await connect.saveConnectUserToken(pairing.controlPlaneUrl, ' user-token ');
assert.equal(await connect.getConnectUserToken(pairing.controlPlaneUrl), 'user-token');
await assert.rejects(connect.getConnectUserToken('http://127.0.0.1:8787'), /not trusted/);
await connect.saveConnectUserToken(pairing.controlPlaneUrl, '');
assert.equal(globalThis.__connectSecrets.size, 0);
globalThis.__connectConfig.extra.connectPilot.testUserToken = ' configured-test-token ';
assert.equal(await connect.getConnectUserToken(pairing.controlPlaneUrl), 'configured-test-token');
assert.equal(Array.from(globalThis.__connectSecrets.values())[0], 'configured-test-token');
delete globalThis.__connectConfig.extra.connectPilot.testUserToken;
await connect.saveConnectUserToken(pairing.controlPlaneUrl, '');

const calls = [];
const claim = { server_url: 'https://m.example.test', machine_id: 'machine-1', machine_name: 'Machine', device_id: 'device-1', device_secret: 'signed-credential', expires_at: new Date(Date.now() + 60_000).toISOString() };
let status = 200, response = claim;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (address, init) => { calls.push({ address, init }); return new Response(status === 204 ? null : JSON.stringify(response), { status }); };
try {
  assert.deepEqual(await connect.claimConnectPairing(pairing, 'user-token', ' My phone '), claim);
  assert.equal(calls[0].address, 'https://api.getopencode.app/v1/pairings/pair-1/claim');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { device_name: 'My phone' });
  assert.ok(!JSON.stringify(calls[0]).includes('temporary-token'));
  assert.equal(calls[0].init.redirect, 'error');
  for (const expected of [401, 403, 404, 409, 429, 502]) {
    status = expected;
    await assert.rejects(connect.claimConnectPairing(pairing, 'user-token', 'Phone'), (error) => error.status === expected && !error.message.includes('signed-credential'));
  }
  status = 200;
  for (const invalid of [{ ...claim, device_secret: undefined }, { ...claim, expires_at: 'bad' }, { ...claim, expires_at: '2000-01-01T00:00:00Z' }, { ...claim, server_url: 'http://m.example.test' }, { ...claim, server_url: 'https://user:secret@m.example.test' }]) {
    response = invalid; await assert.rejects(connect.claimConnectPairing(pairing, 'user-token', 'Phone'));
  }
  response = { machines: [{ id: 'machine-1', name: 'Machine', hostname: 'm.example.test', public_url: claim.server_url, created_at: '2026-10-02T00:00:00Z' }] };
  assert.equal((await connect.listConnectMachines(pairing.controlPlaneUrl, 'user-token'))[0].id, 'machine-1');
  status = 204;
  await connect.revokeConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token');
  assert.equal(calls.at(-1).init.method, 'DELETE');
  assert.equal(calls.at(-1).address, 'https://api.getopencode.app/v1/machines/machine-1');
  const count = calls.length;
  globalThis.__connectConfig.extra.connectPilot.enabled = false;
  await assert.rejects(connect.listConnectMachines(pairing.controlPlaneUrl, 'user-token'), /development builds/);
  assert.throws(() => connect.parseConnectPairing(url.toString()), /development builds/);
  assert.equal(calls.length, count, 'Production gating must prevent all account requests.');
  globalThis.__connectConfig.extra.connectPilot.enabled = true;
} finally { globalThis.fetch = originalFetch; }

// Verify native upgrades add Basic without putting credentials in the URL;
// browser upgrades retain the existing ticket-only behavior.
const service = await import(await moduleUri('../providers/services/terminal-service.ts', [
  [/from 'react-native'/g, `from "${native}"`],
  [/from '@\/lib\/opencode\/client'/g, `from "${uri('export function buildPtyWebSocketUrl() {}')}"`],
  [/from '@\/providers\/services\/require-data'/g, `from "${uri('export function requireData(value) { return value; }')}"`],
]));
const originalSocket = globalThis.WebSocket;
globalThis.WebSocket = class { constructor(...args) { this.args = args; } };
try {
  const socket = service.openTerminalWebSocket('wss://m.example.test/pty/1/connect?ticket=upstream', 'Basic device-credential');
  assert.equal(socket.args[0], 'wss://m.example.test/pty/1/connect?ticket=upstream');
  assert.deepEqual(socket.args[2], { headers: { Authorization: 'Basic device-credential' } });
  globalThis.__connectPlatform = 'web';
  assert.equal(connect.isConnectEnabled(), false);
  assert.deepEqual(service.openTerminalWebSocket('ws://local/pty?ticket=x', 'Basic secret').args, ['ws://local/pty?ticket=x']);
  connect.setConnectTestSecret('secret', 'value');
  assert.equal(connect.getConnectTestSecret('secret'), '');
  globalThis.__connectConfig.extra.e2eMode = true;
  globalThis.__connectConfig.extra.connectPilot.testing = true;
  connect.setConnectTestSecret('secret', 'value');
  assert.equal(connect.getConnectTestSecret('secret'), 'value');
} finally { globalThis.WebSocket = originalSocket; }

const configSource = await readFile(new URL('../app.config.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(configSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function appConfig(variant) {
  const context = { exports: {}, require: createRequire(import.meta.url), process: { env: { EXPO_APP_VARIANT: variant, EXPO_PUBLIC_E2E_MODE: '1', EXPO_CONNECT_CONTROL_PLANES: 'http://127.0.0.1:8787', EXPO_CONNECT_TEST_USER_TOKEN: 'configured-test-token' } } };
  vm.runInNewContext(compiled, context);
  return context.exports.default;
}
const production = appConfig('production'), development = appConfig('development');
assert.equal(production.extra.connectPilot.enabled, false);
assert.equal(production.extra.connectPilot.controlPlanes.length, 0);
assert.equal(production.extra.connectPilot.testUserToken, undefined);
assert.equal(development.extra.connectPilot.enabled, true);
assert.equal(development.extra.connectPilot.testUserToken, 'configured-test-token');
assert.deepEqual(Array.from(development.extra.connectPilot.controlPlanes), ['https://api.getopencode.app']);
assert.notEqual(production.ios.bundleIdentifier, development.ios.bundleIdentifier);
assert.notEqual(production.android.package, development.android.package);
console.log('Connect parser, API, credential gating, config, and native WebSocket tests passed');
