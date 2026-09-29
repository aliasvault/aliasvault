/**
 * Category 15: Vault upgrades (Requires API)
 *
 * These tests verify that a vault written by an old client is upgraded to the current storage format.
 * They require a DEBUG API server, whose test controller puts the old vault on a test account.
 */
import { test, expect, TestClient, Timeouts } from '../fixtures';
import { readLegacyVaultFixture, restoreLegacyVault } from '../helpers/test-api';

test.describe.serial('15. Vault upgrades', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('15.1 should upgrade a 1.0.0 vault to the current storage format', async ({ testUser, apiUrl }) => {
    const fixture = readLegacyVaultFixture('1.0.0');
    await restoreLegacyVault(apiUrl, testUser.username, fixture);

    client = await TestClient.create();
    await client.configureApiUrl(apiUrl);
    await client.attemptLogin(testUser.username, fixture.password);
    const { popup } = client;
    const upgradeButton = popup.locator('button#upgrade-button');

    await test.step('run the legacy database upgrade', async () => {
      await expect(popup.getByText('New available version:')).toBeVisible({ timeout: Timeouts.LONG });
      await client.pause();
      await upgradeButton.click();
      // A self-hosted server (as every test server is) is asked to confirm first.
      const confirmButton = popup.getByRole('button', { name: 'Continue Upgrade' });
      await expect(confirmButton).toBeVisible();
      await client.pause();
      await confirmButton.click();
    });

    await test.step('run the storage format upgrade', async () => {
      await expect(popup.getByText('your other AliasVault apps need version')).toBeVisible({ timeout: Timeouts.LONG });
      await client.pause();
      await upgradeButton.click();
      // The success screen continues on its own after a countdown.
      const continueButton = popup.locator('button#upgrade-continue-button');
      await popup.locator('button#upgrade-continue-button, #nav-vault').first().waitFor({ state: 'visible', timeout: Timeouts.LONG });
      if (await continueButton.isVisible()) {
        await client.pause();
        if (await continueButton.isVisible()) {
          await continueButton.click();
        }
      }
    });

    await test.step('the items of the 1.0.0 vault are there', async () => {
      await client.goToVault();
      for (const name of fixture.expectedItemNames) {
        await expect(popup.getByText(name, { exact: true })).toBeVisible();
      }
      await client.pause();
    });

    await test.step('the server holds the vault in the manifest storage format', async () => {
      const accessToken = testUser.token?.token;
      expect(accessToken, 'the test user was registered with a session').toBeTruthy();
      // The migration push may still be on its way when the vault list shows.
      await expect.poll(async () => {
        const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v2/Vault`, { headers: { Authorization: `Bearer ${accessToken}` } });
        return response.ok ? ((await response.json()) as { storageFormat?: number }).storageFormat : `HTTP ${response.status}`;
      }, { timeout: Timeouts.LONG }).toBe(1);
    });
  });
});
