/**
 * Category 80: Vault errors (requires API)
 *
 * Each test breaks the account's server vault on purpose, then checks the app correctly reports it to the user.
 */
import { test, expect } from '../fixtures';
import { createTestUserWithDamagedKeyChain } from '../helpers/test-api';
import { writeManifestWithBrokenRow, writeUndecryptableManifest } from '../helpers/vault-tamper';

import type { Page } from '@playwright/test';

const KEY_CHAIN_UNREADABLE_MESSAGE = 'Your password is correct, but the encryption keys of your vault could not be opened. Please contact support.';
const VAULT_DATA_UNREADABLE_MESSAGE = 'Your vault data could not be read, so your data is not accessible at this moment. Please contact support.';
const CLIENT_NOT_SUPPORTED_MESSAGE = 'This version of AliasVault is no longer supported by the server. Please update to the latest version.';

/**
 * Check the page shows only the critical error: its message and code in a copyable report, and the support address.
 */
async function expectCriticalError(page: Page, message: string, code: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Your vault could not be loaded' })).toBeVisible();
  await expect(page.getByText('copy the error details below and contact support')).toBeVisible();
  await expect(page.locator('#critical-error-report')).toContainText(`${message} (Code: ${code})`);
  await expect(page.locator('#copy-error-report')).toBeVisible();
  await expect(page.locator('#support-contact').getByRole('link', { name: 'support@example.tld' })).toBeVisible();
  await expect(page.locator('#password')).toHaveCount(0);
}

/**
 * Send every API request of the page as a client version the server no longer supports, so the real server rejects it.
 */
async function sendUnsupportedClientVersion(page: Page, apiUrl: string): Promise<void> {
  await page.route(`${apiUrl}/**`, (route) => route.continue({ headers: { ...route.request().headers(), 'x-aliasvault-client': 'web-0.0.1' } }));
}

/**
 * Check the login page is replaced by the update request, and that its update button loads the app again.
 */
async function expectClientUpdateRequest(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/user\/login$/);
  await expect(page.getByRole('heading', { name: 'Update required' })).toBeVisible();
  await expect(page.locator('#critical-error')).toContainText(CLIENT_NOT_SUPPORTED_MESSAGE);
  await expect(page.locator('#critical-error-report')).toHaveCount(0);
  await expect(page.locator('#support-contact')).toHaveCount(0);
  await expect(page.locator('#password')).toHaveCount(0);

  await test.step('the update button reloads the app', async () => {
    await page.locator('#critical-error-action').click();
    await expect(page.locator('#login-button')).toBeVisible();
    await expect(page.locator('#critical-error')).toHaveCount(0);
  });
}

test.describe('80. Vault errors', () => {
  test('80.1 should report a server vault that does not decrypt', async ({ app, apiUrl, testUser }) => {
    await writeUndecryptableManifest(apiUrl, testUser);

    await app.page.goto('/user/login');
    await app.submitLogin(testUser.username, testUser.password);

    await expect(app.page.locator('#critical-error')).toBeVisible();
    await app.pause();

    await expect(app.page).toHaveURL(/\/sync$/);
    await expectCriticalError(app.page, VAULT_DATA_UNREADABLE_MESSAGE, 'E-503');
    await expect(app.page.locator('#critical-error-report')).toContainText('AES-GCM decryption failed');
  });

  test('80.2 should report a server vault that does not load into the local database', async ({ app, apiUrl, testUser }) => {
    // Decrypts and passes the codec, but the row misses required columns, so materializing it fails.
    await writeManifestWithBrokenRow(apiUrl, testUser, 'Items', { Id: crypto.randomUUID(), Name: 'Broken row' });

    await app.page.goto('/user/login');
    await app.submitLogin(testUser.username, testUser.password);

    await expect(app.page.locator('#critical-error')).toBeVisible();
    await app.pause();

    await expect(app.page).toHaveURL(/\/sync$/);
    await expectCriticalError(app.page, VAULT_DATA_UNREADABLE_MESSAGE, 'E-508');
    await expect(app.page.locator('#critical-error-report')).toContainText('NOT NULL constraint failed');
  });

  test('80.3 should report a key chain the password does not fully open', async ({ app, apiUrl }) => {
    const user = await createTestUserWithDamagedKeyChain(apiUrl);

    await app.page.goto('/user/login');
    await app.submitLogin(user.username, user.password);

    await expect(app.page.locator('#critical-error')).toBeVisible();
    await app.pause();

    // The error replaces the login form instead of landing on the unlock page without explanation.
    await expect(app.page).toHaveURL(/\/user\/login$/);
    await expectCriticalError(app.page, KEY_CHAIN_UNREADABLE_MESSAGE, 'E-207');

    await test.step('going back shows the login form again', async () => {
      await app.page.locator('#critical-error-action').click();
      await expect(app.page.locator('#login-button')).toBeVisible();
    });
  });

  test('80.4 should report a key chain the password does not fully open on unlock', async ({ app, testUser }) => {
    await app.login(testUser.username, testUser.password);

    await test.step('reloading locks the vault', async () => {
      await app.page.reload();
      await expect(app.page).toHaveURL(/\/unlock$/);
    });

    // Unlock fetches the key chain again; damage the encrypted vault key in that response.
    await app.page.route(/\/VaultKey\/[^/]+$/, async (route) => {
      const response = await route.fetch();
      const body = await response.json() as { vaultKey?: { encryptedVek?: string } };
      if (body.vaultKey?.encryptedVek) {
        const encryptedVek = Buffer.from(body.vaultKey.encryptedVek, 'base64');
        encryptedVek[encryptedVek.length - 1] ^= 0xff;
        body.vaultKey.encryptedVek = encryptedVek.toString('base64');
      }
      await route.fulfill({ response, json: body });
    });

    await app.page.locator('#password').fill(testUser.password);
    await app.page.locator('#unlock-button').click();

    await expect(app.page.locator('#critical-error')).toBeVisible();
    await app.pause();

    await expect(app.page).toHaveURL(/\/unlock$/);
    await expectCriticalError(app.page, KEY_CHAIN_UNREADABLE_MESSAGE, 'E-207');
  });

  test('80.5 should ask for an update when the server rejects the client version on login', async ({ app, apiUrl, testUser }) => {
    await sendUnsupportedClientVersion(app.page, apiUrl);

    await app.page.goto('/user/login');
    await app.submitLogin(testUser.username, testUser.password);

    await expect(app.page.locator('#critical-error')).toBeVisible();
    await app.pause();

    await expectClientUpdateRequest(app.page);
  });

  test('80.6 should ask for an update when the server rejects the client version on unlock', async ({ app, apiUrl, testUser }) => {
    await app.login(testUser.username, testUser.password);
    await sendUnsupportedClientVersion(app.page, apiUrl);

    // Reloading locks the vault; the unlock page checks the server status first, which now rejects the client.
    await app.page.reload();

    await expect(app.page.locator('#critical-error')).toBeVisible();
    await app.pause();

    await expectClientUpdateRequest(app.page);
  });
});
