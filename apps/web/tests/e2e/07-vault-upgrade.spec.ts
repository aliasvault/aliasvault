/**
 * Category 7: Vault upgrades.
 */
import { test, expect, type WebApp } from '../fixtures';
import { requireSmtp, sendMail } from '../helpers/smtp';
import { readLegacyVaultFixture, restoreLegacyVault, type LegacyVaultFixture, type TestUser } from '../helpers/test-api';

/**
 * Put the 1.0.0 vault on the account, log in and run both upgrade steps, ending on the items page.
 */
async function upgradeLegacyVault(app: WebApp, apiUrl: string, testUser: TestUser): Promise<LegacyVaultFixture> {
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
    await expect(page).toHaveURL(/\/items$/);
  });

  return fixture;
}

test.describe('7. Vault upgrades', () => {
  /*
   * One after the other: every test account gets the fixture's SRP identity, and the server keys the login handshake
   * on that identity, so two logins at once would overwrite each other's handshake.
   */
  test.describe.configure({ mode: 'default' });

  test('7.1 should upgrade a 1.0.0 vault to the current storage format', async ({ app, apiUrl, testUser }) => {
    const { page } = app;
    const fixture = await upgradeLegacyVault(app, apiUrl, testUser);

    await test.step('the items of the 1.0.0 vault are there', async () => {
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

  test('7.3 should upgrade the verifier of an upgraded vault at the next login', async ({ app, apiUrl, testUser }) => {
    const { page } = app;
    const fixture = await upgradeLegacyVault(app, apiUrl, testUser);

    /**
     * The encryption type the server advertises for the account's password.
     */
    const encryptionType = async (): Promise<string> => {
      const response = await fetch(`${apiUrl}/v2/Auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: testUser.username }) });
      return ((await response.json()) as { encryptionType: string }).encryptionType;
    };

    await test.step('the upgraded vault still has the verifier of the 1.0.0 vault', async () => {
      expect(await encryptionType()).toBe('Argon2Id');
    });

    await test.step('a password login replaces it with the split verifier', async () => {
      await app.logout();
      await app.login(testUser.username, fixture.password);
      expect(await encryptionType()).toBe('Argon2IdHkdf');
    });

    await test.step('the split verifier logs in, and v1 clients are told to update', async () => {
      await app.logout();
      await app.login(testUser.username, fixture.password);
      for (const name of fixture.expectedItemNames) {
        await expect(page.getByText(name, { exact: true })).toBeVisible();
      }

      const v1 = await fetch(`${apiUrl}/v1/Auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: testUser.username }) });
      expect(v1.status).toBe(426);
    });
  });

  test('7.2 should receive and decrypt mail on a new alias after upgrading a 1.0.0 vault', async ({ app, apiUrl, testUser }) => {
    await requireSmtp();
    const { page } = app;
    const id = Math.random().toString(36).substring(2, 10);
    const address = `e2e_${id}@example.tld`;
    const subject = `Mail ${id}`;

    await upgradeLegacyVault(app, apiUrl, testUser);

    await test.step('create a login item with an address on a private domain', async () => {
      await page.locator('#topBarQuickCreateButton').click();
      await page.locator('#serviceName').fill('Mail test');
      await page.locator('#quickIdentitySubmit').click();
      await page.getByRole('button', { name: 'Email', exact: true }).click();
      await page.locator('#email').fill(address);
      await app.saveItemButton().click();
      await expect(page.getByText('Item created successfully')).toBeVisible();
      await app.expectItemView('Mail test');
    });

    await test.step('the SMTP service accepts mail for the address', async () => {
      // A 550 here means the upgraded vault published no email delivery key for its manifest.
      await sendMail({
        from: 'sender@example.com',
        to: address,
        subject,
        text: 'This is a test email plain.',
        html: '<html><body><p>Test email after a vault upgrade.</p></body></html>',
      });
    });

    await test.step('the email shows decrypted on the item page', async () => {
      await page.locator('#recent-email-refresh').click();
      await expect(page.getByText(subject)).toBeVisible();
    });
  });
});
