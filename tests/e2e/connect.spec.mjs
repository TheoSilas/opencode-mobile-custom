import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';

// Native APIs/SecureStore are substituted only in the development E2E build.
const CONTROL_PLANE = 'https://api.getopencode.app';
const SERVER = 'http://127.0.0.1:44096';
const CONNECT_SERVER = 'https://connect-machine.test';
const PRODUCT = 'fixture.connect';
function pairingLink(id = 'pair-1') {
  const url = new URL('opencodemobile://pair');
  for (const [key, value] of Object.entries({ v: '1', cp: CONTROL_PLANE, id, t: 'temporary-test-pairing', n: 'Test Mac' })) url.searchParams.set(key, value);
  return url;
}
async function storeFixture(page, options = {}) {
  await page.addInitScript(({ productId, options }) => {
    const purchase = { id: 'native-transaction', productId, store: 'google', purchaseState: 'purchased', purchaseToken: 'native-test-proof', quantity: 1, transactionDate: Date.now(), isAutoRenewing: true, isAcknowledgedAndroid: false };
    globalThis.__connectStoreTest = {
      products: [{ id: productId, title: 'Connect Monthly', type: 'subs', platform: 'android', displayPrice: '$4.99', currency: 'USD', description: 'Connect', nameAndroid: 'Connect', subscriptionOffers: [{ id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'native-offer', displayPrice: '$4.99', price: 4.99, period: { unit: 'month', value: 1 }, pricingPhasesAndroid: { pricingPhaseList: [{ formattedPrice: '$4.99', billingPeriod: 'P1M', billingCycleCount: 0 }] } }] }],
      nextPurchase: purchase, restoredPurchases: [purchase], purchases: options.recovered ? [purchase] : [],
      events: [], outcome: options.outcome, finishFailures: options.finishFailures,
    };
    if (options.secureFailure) globalThis.__connectSecureWriteFailure = true;
  }, { productId: PRODUCT, options });
}
async function openPair(page, completed = true, id = 'pair-1') {
  if (completed) await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto(`/pair?${pairingLink(id).searchParams}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connect-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/pair$/);
  await expect(page.getByTestId('connect-purchase')).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId('connect-machine-name')).toHaveText('Test Mac');
  await expect(page.getByTestId('connect-user-token')).toHaveCount(0);
  await expect(page.getByTestId('connect-token-required')).toHaveCount(0);
}
async function events(page) { return page.evaluate(() => globalThis.__connectStoreTest.events); }
async function assertNoStoredSecrets(page) {
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  for (const secret of ['device-test-secret', 'test-user-token', 'temporary-test-pairing', 'native-test-proof']) expect(stored).not.toContain(secret);
  expect(page.url()).not.toContain('temporary-test-pairing');
}
async function mockControlPlane(page, options = {}) {
  const paidThrough = Date.now() + (options.ttl ?? 3600000);
  const machine = { id: 'machine-1', name: 'Test Mac', hostname: 'connect-machine.test', public_url: options.serverUrl ?? CONNECT_SERVER, created_at: new Date().toISOString(), access_enabled: true };
  const state = { paidThrough, subscriptionClaims: 0, pairClaims: 0, accesses: 0, deleted: [], machines: options.owned ? [machine] : [], requests: [] };
  await page.route(`${CONNECT_SERVER}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (/\/event$/.test(url.pathname)) { await route.abort(); return; }
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return; }
    const response = await route.fetch({ url: `${SERVER}${url.pathname}${url.search}` });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await page.route('https://offline-machine.test/**', (route) => route.abort());
  const controlPlane = options.controlPlane ?? CONTROL_PLANE;
  await page.route(`${controlPlane}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(new URL(controlPlane).pathname.replace(/\/$/, '').length);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    state.requests.push({ method: request.method(), path });
    const send = (json, status = 200) => route.fulfill({ status, headers, json });
    if (path === '/v1/subscriptions/catalog') {
      expect(request.headers().authorization).toBeUndefined();
      await send({ plans: [{ id: 'connect', entitlements: ['connect'], products: [{ store: 'google', productId: options.productId ?? PRODUCT, basePlanId: 'monthly', offerIds: [] }] }] }, options.catalogStatus ?? 200); return;
    }
    if (path === '/v1/subscriptions/claim') {
      state.subscriptionClaims += 1;
      expect(request.headers().authorization).toBeUndefined();
      expect(request.postDataJSON()).toEqual({ store: 'google', purchaseToken: 'native-test-proof' });
      await page.evaluate(() => globalThis.__connectStoreTest.events.push('claim'));
      if (options.subscriptionStatus && state.subscriptionClaims === 1) { await send({ error: 'store unavailable' }, options.subscriptionStatus); return; }
      await send({ user_id: 'store-owner', user_token: 'test-user-token', session_expires_at: new Date(Date.now() + 86400000).toISOString(), subscription_expires_at: new Date(state.paidThrough).toISOString(), entitlements: ['connect'] }); return;
    }
    expect(request.headers().authorization).toBe('Bearer test-user-token');
    const connection = { server_url: machine.public_url, machine_id: options.mismatch ? 'wrong-machine' : machine.id, machine_name: machine.name, device_id: `device-${state.accesses + 1}`, device_secret: 'device-test-secret', expires_at: new Date(state.paidThrough).toISOString() };
    if (/\/pairings\//.test(path)) {
      state.pairClaims += 1;
      expect(request.postDataJSON()).toEqual({ pairing_token: 'temporary-test-pairing', device_name: 'Web test device' });
      if (options.pairStatus && state.pairClaims === 1) { await send({ error: options.pairStatus === 409 ? 'pairing expired' : 'invalid pairing token' }, options.pairStatus); return; }
      state.machines = [machine];
      if (options.lostResponse && state.pairClaims === 1) { await route.abort(); return; }
      if (state.pairClaims > 1 && options.lostResponse) { await send({ error: 'pairing already redeemed', machine_id: machine.id }, 409); return; }
      if (options.reconciliation && state.pairClaims === 1) { await send({ error: 'access pending', machine_id: machine.id }, 503); return; }
      await send(connection); return;
    }
    if (/\/access$/.test(path)) {
      state.accesses += 1;
      if (Date.now() >= state.paidThrough || options.accessStatus) { await send({ error: 'no active subscription' }, options.accessStatus ?? 403); return; }
      await send({ ...connection, device_id: `device-${state.accesses + 1}` }); return;
    }
    if (request.method() === 'DELETE') {
      state.deleted.push(path.split('/').at(-1)); state.machines = [];
      await route.fulfill({ status: 204, headers }); return;
    }
    await send({ machines: state.machines.map((entry) => ({ ...entry, access_enabled: Date.now() < state.paidThrough })) });
  });
  return state;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${SERVER}/__control/reset`, { data: { scenario: 'happy-path' } })).ok()).toBeTruthy();
});
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

test('Connect defaults to production, saves a custom environment, and keeps pairing trust across relaunch', async ({ page }) => {
  await storeFixture(page);
  const production = await mockControlPlane(page);
  const custom = 'https://staging.connect.test/connect';
  const staging = await mockControlPlane(page, { controlPlane: custom });
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await openPair(page);
  const input = page.getByTestId('connect-control-plane');
  const save = page.getByTestId('connect-save-control-plane');
  await expect(input).toHaveValue(CONTROL_PLANE);
  await input.fill('http://staging.connect.test');
  await save.click();
  await expect(page.getByTestId('connect-error')).toContainText('HTTPS');
  await expect(page.getByTestId('connect-machine-name')).toHaveText('Test Mac');
  await input.fill(`${custom}///`);
  await save.click();
  await expect(input).toHaveValue(custom);
  await expect(page.getByTestId('connect-machine-name')).toHaveCount(0);
  await expect(page.getByTestId('connect-subscription-active')).toHaveCount(0);
  await expect(page.getByTestId('connect-purchase')).toBeEnabled();
  expect(staging.requests).toEqual([{ method: 'GET', path: '/v1/subscriptions/catalog' }]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('opencode-mobile.connect-control-plane'))).toBe(custom);
  await page.getByTestId('connect-pairing-link').fill(pairingLink().toString());
  await page.getByTestId('connect-open-link').click();
  await expect(page.getByTestId('connect-error')).toContainText('trusted control plane');
  expect(production.pairClaims).toBe(0);
  await page.reload();
  await expect(input).toHaveValue(custom);
  await expect(page.getByTestId('connect-purchase')).toBeEnabled();
  const link = pairingLink(); link.searchParams.set('cp', custom);
  await page.goto(`/pair?${link.searchParams}`);
  await expect(page.getByTestId('connect-machine-name')).toHaveText('Test Mac');
  await expect(input).toHaveValue(custom);
  await expect(page).toHaveURL(/\/pair$/);
  await expect(page.getByTestId('connect-purchase')).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/opencode-control-plane-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '/tmp/opencode-control-plane-desktop.png', fullPage: true });
  await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  expect(staging.subscriptionClaims).toBe(1); expect(staging.pairClaims).toBe(1);
  expect(production.subscriptionClaims).toBe(0); expect(production.pairClaims).toBe(0);
  await assertNoStoredSecrets(page);
  expect(runtimeErrors).toEqual([]);
});

test('switching environments clears subscription and machine state and restores only the selected session', async ({ page }) => {
  await storeFixture(page, { recovered: true });
  const production = await mockControlPlane(page, { owned: true });
  const custom = 'https://staging.connect.test';
  const staging = await mockControlPlane(page, { controlPlane: custom, productId: 'fixture.staging' });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair');
  await expect(page.getByTestId('connect-subscription-active')).toBeVisible();
  await expect(page.getByTestId('connect-machine-machine-1')).toBeVisible();
  await expect(page.getByTestId('connect-control-plane')).toBeEditable();
  await page.evaluate(() => {
    const fixture = globalThis.__connectStoreTest;
    fixture.products.push({ ...fixture.products[0], id: 'fixture.staging' });
  });
  await page.getByTestId('connect-control-plane').fill(custom);
  await page.getByTestId('connect-save-control-plane').click();
  await expect(page.getByTestId('connect-purchase')).toBeEnabled();
  await expect(page.getByTestId('connect-subscription-active')).toHaveCount(0);
  await expect(page.getByTestId('connect-machine-machine-1')).toHaveCount(0);
  await expect(page.getByTestId('connect-refresh-machines')).toBeDisabled();
  expect(staging.requests).toEqual([{ method: 'GET', path: '/v1/subscriptions/catalog' }]);
  await page.getByTestId('connect-control-plane').fill(CONTROL_PLANE);
  await page.getByTestId('connect-save-control-plane').click();
  await expect(page.getByTestId('connect-subscription-active')).toBeVisible();
  await expect(page.getByTestId('connect-control-plane')).toBeEditable();
  await page.getByTestId('connect-refresh-machines').click();
  await expect(page.getByTestId('connect-machine-machine-1')).toBeVisible();
  expect(production.subscriptionClaims).toBe(1); expect(staging.subscriptionClaims).toBe(0);
});

test('purchase finalizes then automatically pairs, saves securely, and connects with Basic auth', async ({ page }) => {
  await storeFixture(page);
  const state = await mockControlPlane(page);
  const dataAuth = [];
  page.on('request', (request) => { if (request.url().startsWith(CONNECT_SERVER) && request.headers().authorization) dataAuth.push(request.headers().authorization); });
  await page.setViewportSize({ width: 390, height: 844 });
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await openPair(page);
  await expect(page.getByText('OpenCode Connect', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: '/tmp/opencode-subscriptions-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '/tmp/opencode-subscriptions-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await events(page)).not.toContain('purchase');
  expect(await events(page)).not.toContain('restore');
  expect(state.pairClaims).toBe(0);
  await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  expect(state.subscriptionClaims).toBe(1); expect(state.pairClaims).toBe(1);
  expect((await events(page)).filter((event) => ['purchase', 'claim', 'finish'].includes(event))).toEqual(['purchase', 'claim', 'finish']);
  expect(dataAuth.length).toBeGreaterThan(0);
  expect(dataAuth.every((value) => value === `Basic ${Buffer.from('device-1:device-test-secret').toString('base64')}`)).toBeTruthy();
  await assertNoStoredSecrets(page);
  expect(runtimeErrors).toEqual([]);
});

test('Restore continues the exact pending QR without purchasing', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page);
  await page.getByTestId('connect-restore').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  expect((await events(page)).filter((event) => ['purchase', 'restore', 'claim', 'finish'].includes(event))).toEqual(['restore', 'claim', 'finish']);
  expect(state.pairClaims).toBe(1); await assertNoStoredSecrets(page);
});

for (const [name, options, message] of [
  ['failed verification', { subscriptionStatus: 502 }, 'temporarily unavailable'],
  ['secure session failure', { secureFailure: true }, 'secure session saving failed'],
  ['finalization failure', { finishFailures: 1 }, 'store finalization failed'],
]) {
  test(`${name} retries without another purchase`, async ({ page }) => {
    await storeFixture(page, options); const state = await mockControlPlane(page, options);
    await openPair(page); await page.getByTestId('connect-purchase').click();
    await expect(page.getByTestId('connect-error')).toContainText(message);
    await expect(page.getByTestId('connect-control-plane')).not.toBeEditable();
    expect(state.pairClaims).toBe(0);
    if (!options.finishFailures) expect(await events(page)).not.toContain('finish');
    await page.getByTestId('connect-retry').click();
    await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
    expect((await events(page)).filter((event) => event === 'purchase')).toHaveLength(1);
    expect(state.subscriptionClaims).toBe(options.subscriptionStatus ? 2 : 1);
  });
}

for (const outcome of ['pending', 'canceled']) {
  test(`${outcome} purchases grant and finalize nothing`, async ({ page }) => {
    await storeFixture(page, { outcome }); const state = await mockControlPlane(page);
    await openPair(page); await page.getByTestId('connect-purchase').click();
    await expect(page.getByTestId('connect-notice')).toContainText(outcome === 'pending' ? 'pending store approval' : 'Purchase canceled');
    if (outcome === 'pending') await expect(page.getByTestId('connect-control-plane')).not.toBeEditable();
    expect(state.subscriptionClaims).toBe(0); expect(state.pairClaims).toBe(0);
    expect(await events(page)).not.toContain('finish'); expect(await events(page)).not.toContain('restore');
    await assertNoStoredSecrets(page);
  });
}

test('unfinished native purchase recovery after restart never synchronizes or purchases', async ({ page }) => {
  await storeFixture(page, { recovered: true }); const state = await mockControlPlane(page, { owned: true });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair');
  await expect(page.getByTestId('connect-subscription-active')).toBeVisible();
  await expect.poll(async () => (await events(page)).includes('finish')).toBeTruthy();
  expect(state.subscriptionClaims).toBe(1); expect(await events(page)).not.toContain('restore'); expect(await events(page)).not.toContain('purchase');
  await page.reload();
  await expect.poll(() => state.subscriptionClaims).toBe(2);
  expect(await events(page)).not.toContain('restore'); expect(await events(page)).not.toContain('purchase');
});

test('an expired QR preserves the subscription and accepts a fresh QR without repurchase', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page, { pairStatus: 409 });
  await openPair(page); await page.getByTestId('connect-purchase').click();
  await expect(page.getByTestId('connect-error')).toContainText('pairing expired');
  await expect(page.getByTestId('connect-subscription-active')).toBeVisible();
  await expect(page.getByTestId('connect-machine-name')).toHaveCount(0);
  await page.getByTestId('connect-pairing-link').fill(pairingLink('fresh-pair').toString());
  await page.getByTestId('connect-open-link').click(); await page.getByTestId('connect-claim').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  expect(state.subscriptionClaims).toBe(1); expect((await events(page)).filter((event) => event === 'purchase')).toHaveLength(1);
});

for (const options of [{ lostResponse: true }, { reconciliation: true }]) {
  test(`ambiguous pairing recovers the same owned machine (${Object.keys(options)[0]})`, async ({ page }) => {
    await storeFixture(page); const state = await mockControlPlane(page, options);
    await openPair(page); await page.getByTestId('connect-purchase').click();
    if (options.lostResponse) { await expect(page.getByTestId('connect-error')).toContainText('Retry the same request'); await page.getByTestId('connect-retry').click(); }
    await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
    expect(state.accesses).toBe(1); expect(state.subscriptionClaims).toBe(1);
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')));
    expect(profiles[0].connect.machineId).toBe('machine-1'); expect(profiles[0].serverUrl).toBe(CONNECT_SERVER);
  });
}

test('second-device Restore lists durable machines; access mismatch saves nothing', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page, { owned: true, mismatch: true });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair'); await expect(page.getByTestId('connect-restore')).toBeEnabled();
  await page.getByTestId('connect-restore').click();
  await expect(page.getByTestId('connect-access-machine-1')).toBeVisible();
  await page.getByTestId('connect-access-machine-1').click();
  await expect(page.getByTestId('connect-error')).toContainText('machine_identity_mismatch');
  expect(state.pairClaims).toBe(0); expect(await page.evaluate(() => localStorage.getItem('opencode-mobile.connection-profiles'))).toBeNull();
});

test('second-device Restore reconnects the same owned machine without a QR', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page, { owned: true });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair'); await expect(page.getByTestId('connect-restore')).toBeEnabled();
  await page.getByTestId('connect-restore').click(); await page.getByTestId('connect-access-machine-1').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(0); expect(state.accesses).toBe(1);
  expect(await events(page)).not.toContain('purchase'); await assertNoStoredSecrets(page);
});

test('secure profile-save recovery does not replay pairing or purchase', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem; let fail = true;
    Storage.prototype.setItem = function (key, value) { if (key === 'opencode-mobile.connection-profiles' && fail) { fail = false; throw new Error('storage unavailable'); } return original.call(this, key, value); };
  });
  await page.getByTestId('connect-purchase').click();
  await expect(page.getByTestId('connect-error')).toContainText('secure saving failed');
  await page.getByTestId('connect-retry').click(); await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(1); expect(state.subscriptionClaims).toBe(1);
});

test('expiry stops data-plane traffic while preserving owned machine and profile', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page, { ttl: 8000 });
  await openPair(page); await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  await page.waitForTimeout(8500);
  const requests = [];
  page.on('request', (request) => { if (request.url().startsWith(CONNECT_SERVER)) requests.push(request.url()); });
  await page.waitForTimeout(2000);
  expect(requests).toEqual([]); expect(state.machines).toHaveLength(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).length)).toBe(1);
});

test('fresh-install subscription pairing continues onboarding', async ({ page }) => {
  await storeFixture(page); await mockControlPlane(page); await openPair(page, false);
  await page.getByTestId('connect-purchase').click(); await expect(page.getByTestId('onboarding-workspace')).toBeVisible({ timeout: 30_000 });
});


test('renewal rotates credentials while preserving profile, machine, hostname and scoped favorites', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page); await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  const previous = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles'))[0]);
  const previousScope = Buffer.from(`${previous.serverUrl}\n${previous.username}`).toString('base64url');
  await page.evaluate(({ previousScope }) => {
    localStorage.setItem('opencode-mobile.favorite-sessions', JSON.stringify([{ sessionId: 'remembered', projectPath: '/fixture', connectionScope: previousScope, favoritedAt: Date.now() }]));
    localStorage.setItem('opencode-mobile.last-session-by-project', JSON.stringify({ [previousScope]: { '/fixture': 'remembered' } }));
    localStorage.setItem(`opencode-mobile.sessions.${previousScope}./fixture`, JSON.stringify({ cachedAt: Date.now(), sessions: [{ id: 'remembered', title: 'Remembered', createdAt: 1, updatedAt: 1 }] }));
  }, { previousScope });
  // A second launch has only durable profile metadata; Restore reacquires its
  // store session, then refreshes access on the original machine.
  state.paidThrough += 3600000;
  await page.goto('/pair'); await expect(page.getByTestId('connect-restore')).toBeEnabled();
  await page.evaluate((previousUsername) => {
    const original = Storage.prototype.setItem; let fail = true;
    Storage.prototype.setItem = function (key, value) { if (key === 'opencode-mobile.connection-profiles' && fail && JSON.parse(value)[0].username !== previousUsername) { fail = false; throw new Error('storage unavailable'); } return original.call(this, key, value); };
  }, previous.username);
  await page.getByTestId('connect-restore').click();
  await expect(page.getByTestId('connect-error')).toContainText('secure saving failed');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.favorite-sessions'))[0].connectionScope)).toBe(previousScope);
  await page.getByTestId('connect-retry').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  const updated = await page.evaluate(() => ({ profile: JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles'))[0], favorites: JSON.parse(localStorage.getItem('opencode-mobile.favorite-sessions')), last: JSON.parse(localStorage.getItem('opencode-mobile.last-session-by-project')) }));
  expect(updated.profile.id).toBe(previous.id); expect(updated.profile.name).toBe(previous.name);
  expect(updated.profile.connect.machineId).toBe(previous.connect.machineId); expect(updated.profile.serverUrl).toBe(previous.serverUrl);
  expect(updated.profile.username).not.toBe(previous.username);
  const refreshedScope = Buffer.from(`${updated.profile.serverUrl}\n${updated.profile.username}`).toString('base64url');
  expect(updated.favorites[0].connectionScope).toBe(refreshedScope); expect(updated.last[refreshedScope]['/fixture']).toBe('remembered');
  expect(state.pairClaims).toBe(1); expect(state.accesses).toBe(1); expect(await events(page)).not.toContain('purchase'); await assertNoStoredSecrets(page);
});
