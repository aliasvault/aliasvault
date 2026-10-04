/**
 * Category 80: Vault errors (Requires API)
 *
 * Each test breaks the account's server vault on purpose, then checks the extension shows the real error with
 * its code instead of a generic "server not available" message.
 */
import { test, expect, TestClient, Timeouts } from '../fixtures';
import { writeManifestWithBrokenRow, writeUndecryptableManifest } from '../helpers/vault-tamper';

import type { Page } from '@playwright/test';

const SERVER_NOT_AVAILABLE_MESSAGE = 'The AliasVault server is not available.';

/**
 * Check the login page shows the copyable vault error report with the given code.
 */
async function expectVaultErrorReport(popup: Page, code: string, detail: string): Promise<void> {
  const report = popup.locator('#vault-error-report');
  await expect(report).toBeVisible({ timeout: Timeouts.LONG });
  await expect(report).toContainText('Please copy the error details below and contact support');
  await expect(report).toContainText(`(Code: ${code})`);
  await expect(popup.getByText(SERVER_NOT_AVAILABLE_MESSAGE)).toHaveCount(0);

  await popup.locator('#vault-error-details-toggle').click();
  await expect(popup.locator('#vault-error-details')).toContainText(detail);
  await expect(popup.locator('#copy-error-report')).toBeVisible();
}

/**
 * Check the popup shows the sync failure dialog with the materialize error and its code.
 */
async function expectSyncFailedDialog(popup: Page): Promise<void> {
  await expect(popup.getByRole('heading', { name: 'Sync failed' })).toBeVisible({ timeout: Timeouts.LONG });
  await expect(popup.getByText('(Code: E-508)')).toBeVisible();
  await expect(popup.getByText('NOT NULL constraint failed')).toBeVisible();
  await expect(popup.getByText(SERVER_NOT_AVAILABLE_MESSAGE)).toHaveCount(0);
}

test.describe('80. Vault errors', () => {
  let client: TestClient | undefined;

  test.afterEach(async () => {
    await client?.cleanup();
    client = undefined;
  });

  test('80.1 should report a server vault that does not decrypt on login', async ({ testUser, apiUrl }) => {
    await writeUndecryptableManifest(apiUrl, testUser);

    client = await TestClient.create();
    await client.configureApiUrl(apiUrl);
    await client.attemptLogin(testUser.username, testUser.password);
    await client.pause();

    await expectVaultErrorReport(client.popup, 'E-503', 'AES-GCM decryption failed');
  });

  test('80.2 should report a server vault that does not load into the local database on login', async ({ testUser, apiUrl }) => {
    // Decrypts and passes the codec, but the row misses required columns, so materializing it fails.
    await writeManifestWithBrokenRow(apiUrl, testUser, 'Items', { Id: crypto.randomUUID(), Name: 'Broken row' });

    client = await TestClient.create();
    await client.configureApiUrl(apiUrl);
    await client.attemptLogin(testUser.username, testUser.password);
    await client.pause();

    await expectVaultErrorReport(client.popup, 'E-508', 'NOT NULL constraint failed');
  });

  test('80.3 should report a server vault that does not load during a sync after login', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);
    await client.goToVault();

    await writeManifestWithBrokenRow(apiUrl, testUser, 'Items', { Id: crypto.randomUUID(), Name: 'Broken row' });
    await client.triggerSync();

    await expectSyncFailedDialog(client.popup);
    await client.pause();
  });

  test('80.4 should report a server vault that does not load on unlock', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);
    await client.lockVault();

    await writeManifestWithBrokenRow(apiUrl, testUser, 'Items', { Id: crypto.randomUUID(), Name: 'Broken row' });
    await client.popup.fill('input#password', testUser.password);
    await client.popup.click('button[type="submit"]:has-text("Unlock")');

    // The local vault still unlocks; the sync that follows reports the broken server vault.
    await expectSyncFailedDialog(client.popup);
    await client.pause();
  });
});
