/**
 * Category 7: Vault upgrades (requires API)
 */
import { test, expect } from '../fixtures';
import { readLegacyVaultFixture, restoreLegacyVault } from '../helpers/test-api';

test.describe('7. Vault upgrades', () => {
  test('7.1 should upgrade a 1.0.0 vault to the current storage format', async ({ app, apiUrl, testUser }) => {
    const { page } = app;
    const fixture = readLegacyVaultFixture('1.0.0');
    await restoreLegacyVault(apiUrl, testUser.username, fixture);
    const startUpgrade = page.getByRole('button', { name: 'Start upgrade process' });

    await test.step('log in to the account with the 1.0.0 vault', async () => {
      await app.openStart();
      await page.getByRole('link', { name: 'Log in with existing account' }).click();
      await app.submitLogin(testUser.username, fixture.password);
      await expect(page).toHaveURL(/\/sync$/);
    });

    await test.step('run the legacy database upgrade', async () => {
      await expect(page.getByText('New available version:')).toBeVisible();
      await app.pause();
      await startUpgrade.click();
    });

    await test.step('run the storage format upgrade', async () => {
      await expect(page.getByText('your other AliasVault apps need version')).toBeVisible();
      await app.pause();
      await startUpgrade.click();
      await expect(page.getByText('Vault upgrade successful.')).toBeVisible();
      await page.locator('#upgrade-continue-button').click();
    });

    await test.step('the items of the 1.0.0 vault are there', async () => {
      await expect(page).toHaveURL(/\/items$/);
      for (const name of fixture.expectedItemNames) {
        await expect(page.getByText(name, { exact: true })).toBeVisible();
      }
    });

    await test.step('the server holds the vault in the manifest storage format', async () => {
      const response = await fetch(`${apiUrl}/v2/Vault`, { headers: { Authorization: `Bearer ${testUser.token}` } });
      expect(response.ok).toBe(true);
      expect(((await response.json()) as { storageFormat?: number }).storageFormat).toBe(1);
    });

    await test.step('the upgraded vault opens again after a reload', async () => {
      await app.pause();
      await page.reload();
      await expect(page).toHaveURL(/\/unlock$/);
      await page.locator('#password').fill(fixture.password);
      await page.locator('#unlock-button').click();
      await expect(page).toHaveURL(/\/items$/);
      for (const name of fixture.expectedItemNames) {
        await expect(page.getByText(name, { exact: true })).toBeVisible();
      }
    });
  });
});
