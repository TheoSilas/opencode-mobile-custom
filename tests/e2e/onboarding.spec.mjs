import { expect, test } from '@playwright/test';

// First-run setup coverage. Unlike flows.spec.mjs, these tests intentionally do
// NOT seed `opencode-mobile.onboarding-version`, so the assistant is exercised.

const FAKE_SERVER_URL = 'http://127.0.0.1:44096';

async function resetScenario(request, scenario = 'happy-path') {
  const response = await request.post('http://127.0.0.1:44096/__control/reset', { data: { scenario } });
  expect(response.ok()).toBeTruthy();
}

async function waitForChat(page) {
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
}

async function openManual(page) {
  await page.getByTestId('connection-method-manual').click();
  await page.getByTestId('connection-profile-name-input').fill('Test server');
}

async function seedExistingInstall(page) {
  await page.addInitScript(() => {
    // Seed before hydration, but only once per tab so clearing app storage and
    // reloading really exercises a fresh install.
    const seededKey = 'e2e.existing-install-seeded';
    if (globalThis.sessionStorage.getItem(seededKey)) return;
    globalThis.localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    globalThis.localStorage.setItem(
      'opencode-mobile.settings',
      JSON.stringify({ serverUrl: 'http://127.0.0.1:44096', username: '', directory: '' }),
    );
    globalThis.sessionStorage.setItem(seededKey, '1');
  });
}

test.beforeEach(async ({ request }) => {
  await resetScenario(request);
});

test('fresh install walks through onboarding into a working chat', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Start a new task')).toHaveCount(0);

  await page.getByTestId('onboarding-welcome-start').click();
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await expect(page.getByTestId('onboarding-connect-test')).toHaveCount(0);
  await expect(page.getByTestId('connection-method-chooser')).toBeVisible();
  await openManual(page);
  await expect(page.getByTestId('connection-profile-save-confirm')).toHaveText('Save & connect');

  await page.getByTestId('connection-profile-url-input').fill(FAKE_SERVER_URL);
  await page.getByTestId('connection-profile-save-confirm').click();

  await expect(page.getByTestId('onboarding-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Select / }).first().click();

  await expect(page.getByTestId('onboarding-preferences')).toBeVisible();
  await page.getByTestId('onboarding-preferences-skip').click();

  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await page.getByTestId('onboarding-permissions-skip').click();

  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await page.getByTestId('onboarding-ready-start').click();

  await waitForChat(page);

  // Relaunch must go straight to the app.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForChat(page);
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
});

test('every onboarding step can be skipped', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('onboarding-welcome-start').click();

  // Skip the connection step without contacting a server.
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await page.getByTestId('onboarding-connect-skip').click();

  // No connection was made, so the workspace step has nothing to pick.
  await expect(page.getByTestId('onboarding-workspace')).toBeVisible();
  await page.getByTestId('onboarding-workspace-skip').click();

  await expect(page.getByTestId('onboarding-preferences')).toBeVisible();
  await page.getByTestId('onboarding-preferences-skip').click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await page.getByTestId('onboarding-permissions-skip').click();

  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await page.getByTestId('onboarding-ready-start').click();

  // Completing without a workspace lands on the chat workspace prompt instead
  // of a crash, and onboarding does not reappear on relaunch.
  await expect(page.getByText('Select a project in the Workspaces tab to open its chat context.')).toBeVisible({ timeout: 30_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
});

test('a failed connection keeps entered values and allows retry', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();

  await openManual(page);
  const url = page.getByTestId('connection-profile-url-input');
  await url.fill('http://127.0.0.1:1');
  await page.getByTestId('connection-profile-save-confirm').click();

  await expect(page.getByTestId('connection-profile-error')).toBeVisible({ timeout: 25_000 });
  await expect(url).toHaveValue('http://127.0.0.1:1');

  await url.fill(FAKE_SERVER_URL);
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-workspace')).toBeVisible({ timeout: 20_000 });
});

test('an existing configured installation skips onboarding', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      'opencode-mobile.settings',
      JSON.stringify({ serverUrl: 'http://127.0.0.1:44096', username: '', directory: '' }),
    );
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForChat(page);
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
});

test('clearing app data shows onboarding again', async ({ page }) => {
  await seedExistingInstall(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForChat(page);

  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 30_000 });
});

test('Settings reopens the setup assistant without wiping the connection', async ({ page }) => {
  await seedExistingInstall(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForChat(page);

  await page.getByRole('tab', { name: 'Settings' }).click();
  const setupAssistant = page.getByRole('button', { name: /^Setup assistant/ });
  await expect(setupAssistant).toBeVisible({ timeout: 15_000 });
  await setupAssistant.click();

  await expect(page.getByTestId('onboarding-connect')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Review setup · Step 2 of 6')).toBeVisible();
  await openManual(page);
  await expect(page.getByTestId('connection-profile-url-input')).toHaveValue(FAKE_SERVER_URL);

  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Select / }).first().click();
  await expect(page.getByTestId('onboarding-preferences')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('onboarding-preferences-skip').click();
  await page.getByTestId('onboarding-permissions-skip').click();
  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await page.getByTestId('onboarding-ready-start').click();

  // Review mode returns to Settings with the app still usable.
  await page.getByRole('tab', { name: 'Chat' }).click();
  await waitForChat(page);
});


test('connection prevents duplicate submissions and disables Skip while validating', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();
  await openManual(page);
  await page.getByTestId('connection-profile-url-input').fill(FAKE_SERVER_URL);
  let probes = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route('**/global/health', async (route) => { probes += 1; await pending; await route.continue(); });
  const connect = page.getByTestId('connection-profile-save-confirm');
  await connect.dispatchEvent('click');
  await connect.dispatchEvent('click');
  await expect(connect).toBeDisabled();
  await expect(page.getByTestId('onboarding-connect-skip')).toBeDisabled();
  await expect(page.getByTestId('connection-profile-url-input')).not.toBeEditable();
  await expect.poll(() => probes).toBe(1);
  release();
  await expect(page.getByTestId('onboarding-workspace')).toBeVisible({ timeout: 20_000 });
  expect(probes).toBe(1);
});
