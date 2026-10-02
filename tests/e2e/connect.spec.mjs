import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';

// The web pilot uses transient credentials only to verify provider/UI flows.
// Native secure persistence and authenticated WS upgrades require device QA.
const CONTROL_PLANE = 'https://api.getopencode.app';
const SERVER = 'http://127.0.0.1:44096';
const CONNECT_SERVER = 'https://connect-machine.test';
function pairingLink(id = 'pair-1') {
  const url = new URL('opencodemobile://pair');
  for (const [key, value] of Object.entries({ v: '1', cp: CONTROL_PLANE, id, t: 'temporary-test-pairing', n: 'Test Mac' })) url.searchParams.set(key, value);
  return url;
}
async function openPair(page, completed = true) {
  if (completed) await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto(`/pair?${pairingLink().searchParams}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connect-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('connect-machine-name')).toHaveText('Test Mac');
  await expect(page).toHaveURL(/\/pair$/);
  await expect(page.getByTestId('connect-user-token')).toHaveCount(0);
  await expect(page.getByTestId('connect-device-name')).toHaveCount(0);
  await expect(page.getByTestId('connect-claim')).toBeEnabled();
  await expect(page.getByRole('button', { name: CONTROL_PLANE, exact: true })).toHaveCount(0);
}
async function mockControlPlane(page, options = {}) {
  const state = { claims: 0, claimDeviceNames: [], deleted: [], machines: [], requests: [] };
  await page.route(`${CONNECT_SERVER}/**`, async (route) => {
    const url = new URL(route.request().url());
    // HTTPS connector fixtures forward REST to the existing fake server. SSE
    // deliberately falls back to polling; no control-plane trust override.
    if (/\/event$/.test(url.pathname)) { await route.abort(); return; }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return;
    }
    const response = await route.fetch({ url: `${SERVER}${url.pathname}${url.search}` });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await page.route('https://offline-machine.test/**', (route) => route.abort());
  await page.route(`${CONTROL_PLANE}/**`, async (route) => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    state.requests.push({ method: request.method(), url: request.url(), authorization: request.headers().authorization });
    expect(request.headers().authorization).toBe('Bearer test-user-token');
    if (request.method() === 'POST') {
      state.claims += 1;
      expect(request.postDataJSON()).toEqual({ device_name: 'Web test device' });
      state.claimDeviceNames.push(request.postDataJSON().device_name);
      expect(request.postData()).not.toContain('temporary-test-pairing');
      if (options.status) { await route.fulfill({ status: options.status, headers, json: { error: 'contract error' } }); return; }
      if (options.lostResponse) { await route.abort(); return; }
      const response = { server_url: options.serverUrl ?? CONNECT_SERVER, machine_id: 'machine-1', machine_name: 'Test Mac', device_id: 'device-1', device_secret: 'device-test-secret', expires_at: new Date(Date.now() + (options.ttl ?? 60_000)).toISOString() };
      state.machines = [{ id: response.machine_id, name: response.machine_name, hostname: 'localhost', public_url: response.server_url, created_at: new Date().toISOString() }];
      await route.fulfill({ status: 200, headers, json: response });
    } else if (request.method() === 'DELETE') {
      state.deleted.push(new URL(request.url()).pathname.split('/').at(-1));
      state.machines = [];
      await route.fulfill({ status: 204, headers });
    } else { await route.fulfill({ status: 200, headers, json: { machines: state.machines } }); }
  });
  return state;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${SERVER}/__control/reset`, { data: { scenario: 'happy-path' } })).ok()).toBeTruthy();
});
// Teardown cancels background relays; assertions still await each user action.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

test('claim saves a profile, connects directly, and removes credentials on machine deletion', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    // The existing contract probe deliberately tries unsupported endpoints.
    if (message.type() === 'error' && !/Failed to load resource.*(status of 404|net::ERR_FAILED)/.test(message.text())) runtimeErrors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockControlPlane(page);
  const dataAuth = [];
  page.on('request', (request) => { if (request.url().startsWith(CONNECT_SERVER) && request.headers().authorization) dataAuth.push(request.headers().authorization); });
  await openPair(page);
  await page.getByTestId('connect-claim').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  expect(state.claims).toBe(1);
  expect(dataAuth.length).toBeGreaterThan(0);
  expect(dataAuth.every((value) => value === `Basic ${Buffer.from('device-1:device-test-secret').toString('base64')}`)).toBeTruthy();
  const stored = await page.evaluate(() => ({ profiles: JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')), settings: JSON.parse(localStorage.getItem('opencode-mobile.settings')), all: JSON.stringify(localStorage) }));
  expect(stored.profiles[0].connect.machineId).toBe('machine-1');
  expect(stored.settings.username).toBe('device-1');
  expect(stored.all).not.toContain('device-test-secret');
  expect(stored.all).not.toContain('test-user-token');
  expect(stored.all).not.toContain('temporary-test-pairing');
  expect(state.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Connection/ }).click();
  await page.getByTestId('connection-row-' + stored.profiles[0].id).click();
  await expect(page.getByRole('button', { name: 'Manage Connect', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage Connect', exact: true }).click();
  // Static tabs lose the device secret. The configured test user token is
  // restored automatically; it does not recover connector credentials.
  await expect(page.getByTestId('connect-refresh-machines')).toBeEnabled();
  await page.getByTestId('connect-refresh-machines').click();
  await expect(page.getByTestId('connect-machine-machine-1')).toBeVisible();
  await expect(page.getByTestId('connect-machine-machine-1')).toContainText('Pair this device to obtain credentials.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: '/tmp/opencode-connect-machines.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '/tmp/opencode-connect-desktop.png', fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('connect-revoke-machine-1').click();
  await expect(page.getByTestId('connect-notice')).toContainText('Machine deletion acknowledged');
  expect(state.deleted).toEqual(['machine-1']);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).length)).toBe(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.settings')).password ?? '')).toBe('');
  expect(runtimeErrors).toEqual([]);
});

for (const [status, message] of [[401, 'development test token is invalid'], [403, 'no active subscription'], [404, 'Unknown pairing'], [409, 'expired or was already claimed']]) {
  test(`claim handles ${status} without saving a connection`, async ({ page }) => {
    const state = await mockControlPlane(page, { status });
    await openPair(page);
    await page.getByTestId('connect-claim').click();
    await expect(page.getByTestId('connect-error')).toContainText(message);
    expect(state.claims).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('opencode-mobile.connection-profiles'))).toBeNull();
    await page.waitForTimeout(500);
    expect(state.claims).toBe(1);
  });
}

test('lost claim response requires explicit recovery and never auto-retries', async ({ page }) => {
  const state = await mockControlPlane(page, { lostResponse: true });
  await openPair(page);
  await page.getByTestId('connect-claim').click();
  await expect(page.getByTestId('connect-error')).toContainText('A claim may have completed');
  expect(state.claims).toBe(1);
  await page.getByTestId('connect-pairing-link').fill(pairingLink('fresh-pair').toString());
  await page.getByTestId('connect-open-link').click();
  await expect(page.getByTestId('connect-error')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openPair(page);
  await page.getByTestId('connect-claim').click();
  await expect(page.getByTestId('connect-error')).toContainText('A claim may have completed');
  expect(state.claims).toBe(2);
  expect(state.claimDeviceNames[1]).toBe(state.claimDeviceNames[0]);
});

test('offline machine preserves a claimed profile; expiry blocks relaunch without secrets', async ({ page }) => {
  const state = await mockControlPlane(page, { serverUrl: 'https://offline-machine.test', ttl: 10_000 });
  await openPair(page);
  await page.getByTestId('connect-claim').click();
  await expect(page.getByTestId('connect-error')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('connect-retry-connection')).toBeVisible();
  expect(state.claims).toBe(1);
  await page.getByTestId('connect-retry-connection').click();
  await expect(page.getByTestId('connect-error')).toBeVisible({ timeout: 30_000 });
  expect(state.claims).toBe(1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Connection/ }).click();
  await expect(page.getByTestId('settings-section-overlay-sheet').getByText(/Connect credentials (are missing|expired)/)).toBeVisible({ timeout: 15_000 });
});

test('secure-save recovery retains the claim response without replaying it', async ({ page }) => {
  const state = await mockControlPlane(page);
  await openPair(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    let fail = true;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'opencode-mobile.connection-profiles' && fail) { fail = false; throw new Error('storage unavailable'); }
      return original.call(this, key, value);
    };
  });
  await page.getByTestId('connect-claim').click();
  await expect(page.getByTestId('connect-error')).toContainText('Pairing succeeded, but secure saving failed');
  expect(state.claims).toBe(1);
  await expect(page.getByTestId('connect-claim')).toContainText('Retry secure saving');
  await page.getByTestId('connect-claim').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  expect(state.claims).toBe(1);
});

test('active credential expiry stops data traffic and requires re-pairing', async ({ page }) => {
  const state = await mockControlPlane(page, { ttl: 5000 });
  await openPair(page);
  await page.getByTestId('connect-claim').click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 30_000 });
  await page.waitForTimeout(5500);
  const requests = [];
  page.on('request', (request) => { if (request.url().startsWith(CONNECT_SERVER)) requests.push(request.url()); });
  await page.waitForTimeout(2500);
  expect(requests).toEqual([]);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Connection/ }).click();
  await expect(page.getByTestId('settings-section-overlay-sheet').getByText('Connect credentials expired. Pair this device again.')).toBeVisible();
  expect(state.claims).toBe(1);
});

test('a fresh-install pairing continues through workspace onboarding', async ({ page }) => {
  await mockControlPlane(page);
  await openPair(page, false);
  await page.getByTestId('connect-claim').click();
  await expect(page.getByTestId('onboarding-workspace')).toBeVisible({ timeout: 30_000 });
});
