import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
globalThis.__connectConfig = { extra: { connectPilot: { enabled: false, controlPlanes: ['https://api.getopencode.app', 'http://127.0.0.1:8787'] } } };
globalThis.__connectPlatform = 'ios';
globalThis.__connectSecrets = new Map();
const constants = uri('export default { get expoConfig() { return globalThis.__connectConfig; } };');
const native = uri('export const Platform = { get OS() { return globalThis.__connectPlatform; } };');
const secure = uri(`export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 1;
  export async function getItemAsync(key) { return globalThis.__connectSecrets.get(key) ?? null; }
  export async function setItemAsync(key, value) { if (globalThis.__secureWriteFails) throw new Error('secure write failed'); globalThis.__subscriptionEvents?.push('secure'); globalThis.__connectSecrets.set(key, value); }
  export async function deleteItemAsync(key) { globalThis.__connectSecrets.delete(key); }`);
const connect = await import(await moduleUri('../lib/connect.ts', [
  [/from 'expo\/fetch'/g, `from "${uri('export const fetch = (...args) => globalThis.fetch(...args);')}"`],
  [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`], [/from 'expo-secure-store'/g, `from "${secure}"`],
]));
const url = new URL('opencodemobile://pair');
for (const [key, value] of Object.entries({ v: '1', cp: 'https://api.getopencode.app', id: 'pair-1', t: 'temporary-token', n: 'Mac & Studio' })) url.searchParams.set(key, value);
const pairing = connect.parseConnectPairing(url.toString());
assert.equal(connect.isConnectEnabled(), true, 'Native pairing must not depend on a development flag.');
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
const session = { user_id: 'owner', user_token: 'user-token', session_expires_at: new Date(Date.now() + 86400000).toISOString(), subscription_expires_at: new Date(Date.now() + 3600000).toISOString(), entitlements: ['connect'] };
await connect.saveConnectSession(pairing.controlPlaneUrl, 'apple', session);
assert.deepEqual(await connect.getConnectSession(pairing.controlPlaneUrl, 'apple'), session);
assert.equal(await connect.getConnectSession(pairing.controlPlaneUrl, 'google'), undefined, 'Store identities stay separate.');
await assert.rejects(connect.getConnectSession('http://127.0.0.1:8787', 'apple'), /not trusted/);
assert.equal(connect.hasConnectEntitlement(session), true);
assert.equal(connect.hasConnectEntitlement({ ...session, subscription_expires_at: '2000-01-01T00:00:00Z' }), false);
assert.equal(connect.hasConnectSession({ ...session, subscription_expires_at: '2000-01-01T00:00:00Z' }), true, 'Entitlement expiry does not erase a valid identity session.');
await connect.savePendingConnectPairing(pairing.controlPlaneUrl, 'apple', pairing);
assert.deepEqual(await connect.getPendingConnectPairing(pairing.controlPlaneUrl, 'apple'), pairing);
await connect.savePendingConnectPairing(pairing.controlPlaneUrl, 'apple');
assert.equal(await connect.getPendingConnectPairing(pairing.controlPlaneUrl, 'apple'), undefined);

const calls = [];
const claim = { server_url: 'https://m.example.test', machine_id: 'machine-1', machine_name: 'Machine', device_id: 'device-1', device_secret: 'signed-credential', expires_at: new Date(Date.now() + 60_000).toISOString() };
let status = 200, response = claim;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (address, init) => { calls.push({ address, init }); return new Response(status === 204 ? null : JSON.stringify(response), { status }); };
try {
  assert.deepEqual(await connect.claimConnectPairing(pairing, 'user-token', ' My phone '), claim);
  assert.equal(calls[0].address, 'https://api.getopencode.app/v1/pairings/pair-1/claim');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { pairing_token: 'temporary-token', device_name: 'My phone' });
  assert.ok(!calls[0].address.includes('temporary-token'));
  assert.equal(calls[0].init.redirect, 'error');
  for (const expected of [401, 403, 404, 409, 429, 502]) {
    status = expected;
    await assert.rejects(connect.claimConnectPairing(pairing, 'user-token', 'Phone'), (error) => error.status === expected && !error.message.includes('signed-credential'));
  }
  status = 200;
  for (const invalid of [{ ...claim, device_secret: undefined }, { ...claim, expires_at: 'bad' }, { ...claim, expires_at: '2000-01-01T00:00:00Z' }, { ...claim, server_url: 'http://m.example.test' }, { ...claim, server_url: 'https://user:secret@m.example.test' }]) {
    response = invalid; await assert.rejects(connect.claimConnectPairing(pairing, 'user-token', 'Phone'));
  }
  response = { machines: [{ id: 'machine-1', name: 'Machine', hostname: 'm.example.test', public_url: claim.server_url, created_at: '2026-10-02T00:00:00Z', access_enabled: true }] };
  assert.equal((await connect.listConnectMachines(pairing.controlPlaneUrl, 'user-token'))[0].id, 'machine-1');
  response = claim;
  assert.equal((await connect.accessConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token')).machine_id, 'machine-1');
  response = { ...claim, machine_id: 'other-machine' };
  await assert.rejects(connect.accessConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token'), /machine_identity_mismatch/);
  response = { ...session, acknowledgement_pending: true };
  assert.deepEqual(await connect.claimConnectSubscription(pairing.controlPlaneUrl, { store: 'apple', signedTransaction: 'native.jws.proof' }), session);
  assert.equal(calls.at(-1).init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { store: 'apple', signedTransaction: 'native.jws.proof' });
  assert.ok(!calls.at(-1).address.includes('native.jws.proof'));
  const catalog = { plans: [{ id: 'connect', entitlements: ['connect'], products: [{ store: 'apple', productId: 'test.apple' }, { store: 'google', productId: 'test.google', basePlanId: 'monthly', offerIds: ['trial'] }] }] };
  response = catalog;
  assert.deepEqual(await connect.getConnectCatalog(pairing.controlPlaneUrl), catalog);
  assert.equal(calls.at(-1).init.headers.Authorization, undefined);
  response = { plans: [catalog.plans[0], catalog.plans[0]] };
  await assert.rejects(connect.getConnectCatalog(pairing.controlPlaneUrl), /Ambiguous/);
  assert.equal(new connect.ConnectApiError(409, { machine_id: 'machine-1' }).machineId, 'machine-1');
  assert.equal(new connect.ConnectApiError(503, { machine_id: 'machine-1' }).machineId, 'machine-1');
  status = 204;
  await connect.revokeConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token');
  assert.equal(calls.at(-1).init.method, 'DELETE');
  assert.equal(calls.at(-1).address, 'https://api.getopencode.app/v1/machines/machine-1');
  const count = calls.length;
  await assert.rejects(connect.listConnectMachines(pairing.controlPlaneUrl, ''), (error) => error.status === 401);
  globalThis.__connectPlatform = 'web';
  await assert.rejects(connect.listConnectMachines(pairing.controlPlaneUrl, 'user-token'), /iOS and Android/);
  assert.throws(() => connect.parseConnectPairing(url.toString()), /iOS and Android/);
  assert.equal(calls.length, count, 'Missing authentication and unsupported platforms must not make account requests.');
  globalThis.__connectPlatform = 'ios';
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
assert.equal(production.extra.connectPilot.enabled, undefined);
assert.equal(production.extra.connectPilot.controlPlanes, undefined);
assert.equal(production.extra.connectPilot.testUserToken, undefined);
assert.equal(development.extra.connectPilot.testUserToken, undefined);
assert.equal(development.extra.connectPilot.controlPlanes, undefined);
assert.notEqual(production.ios.bundleIdentifier, development.ios.bundleIdentifier);
assert.notEqual(production.android.package, development.android.package);
for (const config of [production, development]) {
  assert.ok(config.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera'), 'Every native build needs camera permission configuration.');
  globalThis.__connectConfig = config;
  for (const platform of ['ios', 'android']) {
    globalThis.__connectPlatform = platform;
    assert.equal(connect.isConnectEnabled(), true);
    assert.deepEqual(connect.parseConnectPairing(url.toString()), pairing);
  }
}
// Gradle regenerates Expo configuration; it must use the same variant as
// prebuild, even when the caller has a conflicting variant in the environment.
for (const variant of ['development', 'production']) {
  const file = variant === 'development' ? 'build-android-development' : 'build-android-release';
  const source = (await readFile(new URL(`../scripts/${file}.mjs`, import.meta.url), 'utf8')).replace(/^#!.*\n/, '');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, allowJs: true, esModuleInterop: true } }).outputText;
  const commands = [];
  const environment = { EXPO_APP_VARIANT: variant === 'development' ? 'production' : 'development', ANDROID_KEYSTORE_PATH: '/fake/store', ANDROID_KEYSTORE_PASSWORD: 'test', ANDROID_KEY_ALIAS: 'test', ANDROID_KEY_PASSWORD: 'test' };
  const actualRequire = createRequire(import.meta.url);
  await vm.runInNewContext(`(async () => { ${code} })()`, {
    exports: {}, Buffer,
    process: { env: environment, cwd: () => '/fake/project', exit: () => { throw new Error('Build script failed'); } },
    console: { log() {}, warn() {}, error() {} },
    require: (name) => name === 'node:child_process' ? {
      spawnSync(command, args, options) { commands.push({ command, env: options?.env ?? environment }); return { status: 0, stdout: 'Alias name: test\n' }; },
    } : name === 'node:fs' ? {
      existsSync: () => true, copyFileSync() {}, statSync: () => ({ size: 128 }), readFileSync: () => Buffer.alloc(128),
    } : actualRequire(name),
  });
  const nativeCommands = commands.filter(({ command }) => command === 'npx' || command === './gradlew');
  assert.deepEqual(nativeCommands.map(({ command }) => command), ['npx', './gradlew']);
  for (const command of nativeCommands) assert.equal(command.env.EXPO_APP_VARIANT, variant);
}
console.log('Connect parser, API, credentials, native availability, camera config, build variants, and WebSocket tests passed');

// Test the actual store/backend aggregation, including crash-recovery checkpoints.
const storeUri = await moduleUri('../lib/connect-store.ts', [
  [/from '@\/lib\/connect'/g, `from "${await moduleUri('../lib/connect.ts', [[/from 'expo\/fetch'/g, `from "${uri('export const fetch = (...args) => globalThis.fetch(...args);')}"`], [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`], [/from 'expo-secure-store'/g, `from "${secure}"`]])}"`],
  [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`],
]);
const storeApi = await import(storeUri);
const connectUri = await moduleUri('../lib/connect.ts', [
  [/from 'expo\/fetch'/g, `from "${uri('export const fetch = (...args) => globalThis.fetch(...args);')}"`],
  [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`], [/from 'expo-secure-store'/g, `from "${secure}"`],
]);
const subscriptionService = await import(await moduleUri('../providers/services/connect-subscription-service.ts', [
  [/from '@\/lib\/connect'/g, `from "${connectUri}"`], [/from '@\/lib\/connect-store'/g, `from "${storeUri}"`],
]));
const fixtureCatalog = { plans: [{ id: 'connect', entitlements: ['connect'], products: [{ store: 'apple', productId: 'fixture.apple' }, { store: 'google', productId: 'fixture.google', basePlanId: 'monthly', offerIds: ['trial'] }] }] };
const googleProduct = { id: 'fixture.google', platform: 'android', type: 'subs', title: 'Monthly', displayPrice: '$4.99', subscriptionOffers: [
  { id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'base-offer', displayPrice: '$4.99', price: 4.99, period: { unit: 'month', value: 1 } },
  { id: 'trial', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'trial-offer', displayPrice: '$0', price: 0 },
  { id: 'not-advertised', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'bad-offer', displayPrice: '$0', price: 0 },
  { id: 'yearly', basePlanIdAndroid: 'yearly', offerTokenAndroid: 'wrong-base', displayPrice: '$40', price: 40 },
] };
const selected = storeApi.selectConnectOffers(fixtureCatalog, [googleProduct], 'google');
assert.equal(selected.length, 2);
assert.equal(storeApi.isConnectPurchase(fixtureCatalog, { productId: 'fixture.google', store: 'google' }, 'google'), true);
assert.equal(storeApi.isConnectPurchase(fixtureCatalog, { productId: 'fixture.google', store: 'apple' }, 'google'), false);
assert.equal(storeApi.selectConnectOffers(fixtureCatalog, [], 'google').length, 0);
assert.equal(storeApi.selectConnectOffers(fixtureCatalog, [{ id: 'fixture.apple', type: 'subs', platform: 'ios', isFamilyShareableIOS: true }], 'apple').length, 0);
const appleProduct = { id: 'fixture.apple', type: 'subs', platform: 'ios', isFamilyShareableIOS: false, displayPrice: '$4.99', subscriptionOffers: [{ type: 'introductory', displayPrice: '$0', period: { unit: 'week', value: 1 }, periodCount: 1 }] };
assert.deepEqual(storeApi.selectConnectOffers(fixtureCatalog, [appleProduct], 'apple')[0].phases, []);
assert.deepEqual(storeApi.selectConnectOffers(fixtureCatalog, [appleProduct], 'apple', new Set(['fixture.apple']))[0].phases, [{ price: '$0', period: { unit: 'week', value: 1 }, cycles: 1 }]);
const replaced = storeApi.connectPurchaseRequest(selected[0], { productId: 'previous', purchaseToken: 'previous-token' }, 'google');
assert.equal(replaced.request.google.purchaseToken, 'previous-token');
assert.deepEqual(replaced.request.google.subscriptionProductReplacementParams, { oldProductId: 'previous', replacementMode: 'deferred' });
assert.equal(storeApi.connectPurchaseRequest({ productId: 'fixture.apple' }, undefined, 'apple').request.apple.andDangerouslyFinishTransactionAutomatically, false);
assert.deepEqual(storeApi.AVAILABLE_CONNECT_PURCHASES, { onlyIncludeActiveItemsIOS: true, alsoPublishToEventListenerIOS: false });
assert.deepEqual(storeApi.parseBillingPeriod('P3M'), { value: 3, unit: 'month' });

for (const platform of ['apple', 'google']) {
  globalThis.__connectPlatform = platform === 'apple' ? 'ios' : 'android';
  const phases = [];
  globalThis.__subscriptionEvents = phases;
  const purchase = { id: 'transaction', productId: 'fixture', store: platform, purchaseToken: platform === 'apple' ? 'exact.native.jws' : 'exact-google-token', purchaseState: 'purchased' };
  let claimStatus = 200, claims = 0, finishFails = false;
  const nativeApi = {
    getTransactionJwsIOS: async () => 'fallback.native.jws',
    finishTransaction: async ({ purchase: finished, isConsumable }) => {
      phases.push('finish');
      assert.equal(finished, purchase); assert.equal(isConsumable, false);
      assert.ok(Array.from(globalThis.__connectSecrets.values()).includes(JSON.stringify(session)), 'Session must already be durable at finalization.');
      if (finishFails) throw new Error('store unavailable');
    },
  };
  globalThis.fetch = async (_url, init) => {
    phases.push('claim'); claims += 1;
    assert.deepEqual(JSON.parse(init.body), platform === 'apple' ? { store: 'apple', signedTransaction: 'exact.native.jws' } : { store: 'google', purchaseToken: 'exact-google-token' });
    return new Response(JSON.stringify(session), { status: claimStatus });
  };
  const complete = (pending) => subscriptionService.finalizeConnectPurchase(pairing.controlPlaneUrl, platform, pending, nativeApi, () => undefined);
  try {
    await complete({ purchase }); assert.deepEqual(phases, ['claim', 'secure', 'finish']);
    phases.length = 0; claimStatus = 502;
    await assert.rejects(complete({ purchase })); assert.deepEqual(phases, ['claim']);
    phases.length = 0; claimStatus = 200; globalThis.__secureWriteFails = true;
    const saving = { purchase };
    await assert.rejects(complete(saving), /secure session saving failed/); assert.deepEqual(phases, ['claim']);
    globalThis.__secureWriteFails = false; phases.length = 0;
    await complete(saving); assert.deepEqual(phases, ['secure', 'finish']);
    phases.length = 0; finishFails = true; const unfinished = { purchase };
    await assert.rejects(complete(unfinished), /store finalization failed/); assert.deepEqual(phases, ['claim', 'secure', 'finish']);
    phases.length = 0; finishFails = false;
    await complete(unfinished); assert.deepEqual(phases, ['finish'], 'Finalization retry must not claim or purchase again.');
    phases.length = 0; const previousClaims = claims;
    await complete({ purchase }); assert.equal(claims, previousClaims + 1, 'Restart safely exchanges the rediscovered proof again.');
    phases.length = 0;
    await assert.rejects(complete({ purchase: { ...purchase, purchaseState: 'pending' } }), /pending/); assert.deepEqual(phases, []);
    await assert.rejects(complete({ purchase: { ...purchase, store: platform === 'apple' ? 'google' : 'apple' } }), /different store/); assert.deepEqual(phases, []);
  } finally { globalThis.fetch = originalFetch; globalThis.__secureWriteFails = false; delete globalThis.__subscriptionEvents; }
}
console.log('Subscription catalog, native proof, DEFERRED replacement, secure grant/finalization and recovery checks passed');
