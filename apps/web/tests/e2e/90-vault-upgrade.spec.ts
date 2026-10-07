/**
 * Category 90: Vault upgrades from older versions.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as OTPAuth from 'otpauth';

import { test, expect, type WebApp } from '../fixtures';
import { requireSmtp, sendMail } from '../helpers/smtp';
import { getVaultSnapshotHeader, readLegacyVaultFixture, restoreLegacyVault, type LegacyVaultFixture, type LegacyVaultItem, type TestUser } from '../helpers/test-api';

/**
 * Log in from the start page to an account whose vault still needs an upgrade, ending on the sync page.
 */
async function loginToUpgradeScreen(app: WebApp, username: string, password: string): Promise<void> {
  await app.openStart();
  await app.page.getByRole('link', { name: 'Log in with existing account' }).click();
  await app.submitLogin(username, password);
  await expect(app.page).toHaveURL(/\/sync$/);
}

/**
 * Put a legacy vault on the account, log in and run the upgrade steps it needs, ending on the items page.
 */
async function upgradeLegacyVault(app: WebApp, apiUrl: string, testUser: TestUser, version = '0.1.0'): Promise<LegacyVaultFixture> {
  const { page } = app;
  const fixture = readLegacyVaultFixture(version);
  await restoreLegacyVault(apiUrl, testUser.username, fixture);
  const startUpgrade = page.getByRole('button', { name: 'Start upgrade process' });

  await test.step(`log in to the account with the ${version} vault`, async () => {
    await loginToUpgradeScreen(app, testUser.username, fixture.password);
  });

  // Only a vault from before database version 2.0.0 has to run the legacy database upgrade first.
  if (Number(String(fixture.vault.version).split('.')[0]) < 2) {
    await test.step('run the legacy database upgrade', async () => {
      await expect(page.getByText('New available version:')).toBeVisible();
      await app.pause();
      await startUpgrade.click();
    });
  }

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

/**
 * The item type names as the view page shows them.
 */
const ITEM_TYPE_LABELS: Record<string, string> = { Login: 'Login', Alias: 'Alias', CreditCard: 'Credit Card', Note: 'Secure Note' };

/**
 * Escape a text for use inside a regular expression.
 */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Open the view page of a legacy vault item from the vault list, going through its folders.
 */
async function openLegacyItem(app: WebApp, item: LegacyVaultItem): Promise<void> {
  const { page } = app;
  await app.openVault();
  for (const folder of item.folderPath) {
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(folder)} \\d+$`) }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`^${escapeRegExp(folder)} \\(`) })).toBeVisible();
  }
  await page.getByText(item.name, { exact: true }).first().click();
  await app.expectItemView(item.name);
}

/**
 * Check that the open view page shows everything the legacy vault holds for the item.
 */
async function expectLegacyItemContent(app: WebApp, item: LegacyVaultItem): Promise<void> {
  const { page } = app;
  const main = page.getByRole('main');

  await expect(main.getByText(ITEM_TYPE_LABELS[item.type], { exact: true }).first()).toBeVisible();
  const logo = main.getByRole('img', { name: item.name, exact: true });
  if (item.logoSource) {
    await expect(logo).toHaveAttribute('src', /^data:image\//);
  } else {
    await expect(logo).toHaveCount(0);
  }

  for (const field of item.fields) {
    if (field.key === 'login.url') {
      await expect(main.getByRole('link', { name: field.value, exact: true })).toBeVisible();
    } else if (field.key === 'notes.content') {
      await expect(main.getByText(field.value, { exact: true })).toBeVisible();
    } else {
      await expect(main.locator(`[id="${field.key.replace('.', '-')}"]`)).toHaveValue(field.value);
    }
  }

  for (const field of item.customFields) {
    await expect(main.getByText(field.label, { exact: true })).toBeVisible();
    if (field.type === 'URL') {
      await expect(main.getByRole('link', { name: field.value, exact: true })).toBeVisible();
    } else if (field.type === 'TextArea') {
      await expect(main.getByText(field.value, { exact: true })).toBeVisible();
    } else {
      await expect(main.getByLabel(field.label, { exact: true })).toHaveValue(field.value);
    }
  }

  for (const totpCode of item.totpCodes) {
    // The shown code proves the secret: it is the code of this or (around a period change) the previous or next 30 seconds.
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(totpCode.secretKey) });
    const tile = main.getByRole('button', { name: new RegExp(`^${escapeRegExp(totpCode.name)} \\d{3} \\d{3}`) });
    await expect(async () => {
      const shown = ((await tile.textContent()) ?? '').replace(totpCode.name, '').replace(/\D/g, '').slice(0, 6);
      expect([-30000, 0, 30000].map(offset => totp.generate({ timestamp: Date.now() + offset }))).toContain(shown);
    }).toPass();
  }

  for (const attachment of item.attachments) {
    const tile = main.getByRole('button', { name: new RegExp(`^${escapeRegExp(attachment.filename)} `) });
    const [download] = await Promise.all([page.waitForEvent('download'), tile.click()]);
    const bytes = readFileSync(await download.path());
    expect(bytes.length, `size of ${attachment.filename}`).toBe(attachment.size);
    expect(createHash('sha256').update(bytes).digest('hex'), `content of ${attachment.filename}`).toBe(attachment.sha256);
  }

  for (const passkey of item.passkeys) {
    await expect(main.getByText(passkey.rpId, { exact: true })).toBeVisible();
    await expect(main.getByText(passkey.displayName, { exact: true })).toBeVisible();
  }

  if (item.passwordHistory) {
    await main.getByRole('button', { name: 'View history' }).click();
    const history = page.locator('#fieldHistoryModal');
    await expect(history.locator('input')).toHaveCount(item.passwordHistory.length);
    // Newest first.
    const shown = await history.locator('input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
    expect(shown).toEqual([...item.passwordHistory].reverse());
    await history.getByRole('button', { name: 'Close' }).click();
    await expect(history).toHaveCount(0);
  }

  // What was removed in the old client stays removed.
  for (const removed of [...(item.removed?.customFields ?? []), ...(item.removed?.totpCodes ?? []), ...(item.removed?.attachments ?? [])]) {
    await expect(main.getByText(removed, { exact: true })).toHaveCount(0);
  }
}

/**
 * Check that the open vault shows everything a legacy vault fixture holds: items, folders, trash and settings.
 */
async function expectLegacyVaultContent(app: WebApp, fixture: LegacyVaultFixture): Promise<void> {
  const { page } = app;
  const content = fixture.expected;
  if (!content) {
    throw new Error('The legacy vault fixture does not list its content.');
  }

  await test.step('the vault list shows the items outside folders only', async () => {
    await app.openVault();
    for (const name of fixture.expectedItemNames) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
    const notListed = [...content.items.filter(item => item.folderPath.length > 0), ...content.trashedItems].map(item => item.name);
    for (const name of [...notListed, ...content.purgedItemNames, ...content.deletedFolderNames]) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  });

  for (const item of content.items) {
    await test.step(`item "${item.name}" is complete`, async () => {
      await openLegacyItem(app, item);
      await expectLegacyItemContent(app, item);
    });
  }

  await test.step('the trash holds the trashed items, not the permanently deleted ones', async () => {
    await app.openVault();
    await page.getByRole('button', { name: /^Vault \(/ }).click();
    await page.getByRole('button', { name: new RegExp(`^Recently Deleted ${content.trashedItems.length}$`) }).click();
    await expect(page).toHaveURL(/\/items\/recently-deleted$/);
    for (const item of content.trashedItems) {
      await expect(page.getByText(item.name, { exact: true })).toBeVisible();
    }
    for (const name of content.purgedItemNames) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  });

  await test.step('the identity generator settings are kept', async () => {
    await page.locator('#userMenuButton').click();
    await page.locator('#userMenu').getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('main').locator('a[href="/settings/identity-generator"]').click();
    await expect(page.locator('#defaultIdentityLanguage')).toHaveValue(content.settings.DefaultIdentityLanguage);
    await expect(page.locator('#defaultIdentityGender')).toHaveValue(content.settings.DefaultIdentityGender);
    await expect(page.locator('#defaultIdentityAgeRange')).toHaveValue(content.settings.DefaultIdentityAgeRange);
  });
}

test.describe('90. Vault upgrades', () => {
  /*
   * One after the other: every test account gets the fixture's SRP identity, and the server keys the login handshake
   * on that identity, so two logins at once would overwrite each other's handshake.
   */
  test.describe.configure({ mode: 'default' });

  test('90.1 should upgrade a 0.1.0 vault to the current storage format', async ({ app, apiUrl, testUser }) => {
    const { page } = app;
    const fixture = await upgradeLegacyVault(app, apiUrl, testUser);

    await test.step('the items of the 0.1.0 vault are there', async () => {
      for (const name of fixture.expectedItemNames) {
        await expect(page.getByText(name, { exact: true })).toBeVisible();
      }
    });

    await test.step('the server holds the vault in the manifest storage format', async () => {
      const snapshot = await getVaultSnapshotHeader<{ storageFormat?: string }>(apiUrl, testUser.token);
      expect(snapshot.storageFormat).toBe('manifest');
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

  test('90.2 should receive and decrypt mail on a new alias after upgrading a 0.1.0 vault', async ({ app, apiUrl, testUser }) => {
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

  test('90.3 should upgrade the verifier of an upgraded vault at the next login', async ({ app, apiUrl, testUser }) => {
    const { page } = app;
    const fixture = await upgradeLegacyVault(app, apiUrl, testUser);

    /**
     * The encryption type the server advertises for the account's password.
     */
    const encryptionType = async (): Promise<string> => {
      const response = await fetch(`${apiUrl}/v2/Auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: testUser.username }) });
      return ((await response.json()) as { encryptionType: string }).encryptionType;
    };

    await test.step('the upgraded vault still has the verifier of the 0.1.0 vault', async () => {
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

  test('90.4 should keep everything a 0.30.7 vault holds when upgrading it', async ({ app, apiUrl, testUser }) => {
    test.slow();
    const fixture = await upgradeLegacyVault(app, apiUrl, testUser, '0.30.7');

    await test.step('the upgraded vault shows what the 0.30.7 clients stored', async () => {
      await expectLegacyVaultContent(app, fixture);
    });

    await test.step('a new login reads the same vault back from the server', async () => {
      await app.logout();
      await app.login(testUser.username, fixture.password);
      await expectLegacyVaultContent(app, fixture);
    });
  });

  for (const [number, version] of [['90.5', '0.1.0'], ['90.6', '0.30.7']]) {
    test(`${number} should open a ${version} vault that another session upgraded while this one waited on the upgrade screen`, async ({ app, newApp, apiUrl, testUser }) => {
      const fixture = readLegacyVaultFixture(version);
      await restoreLegacyVault(apiUrl, testUser.username, fixture);
      // A separate browser context: a standalone client that shares nothing with the first.
      const other = await newApp();
      const runsLegacyDatabaseUpgrade = Number(String(fixture.vault.version).split('.')[0]) < 2;
      const firstScreenText = runsLegacyDatabaseUpgrade ? 'New available version:' : 'your other AliasVault apps need version';

      await test.step('both sessions log in and wait on the upgrade screen', async () => {
        // One after the other: the server keys the login handshake on the account's SRP identity.
        for (const session of [app, other]) {
          await loginToUpgradeScreen(session, testUser.username, fixture.password);
          await expect(session.page.getByText(firstScreenText)).toBeVisible();
        }
      });

      await test.step('the first session upgrades the vault', async () => {
        await app.pause();
        if (runsLegacyDatabaseUpgrade) {
          await app.page.getByRole('button', { name: 'Start upgrade process' }).click();
          await expect(app.page.getByText('your other AliasVault apps need version')).toBeVisible();
        }
        await app.page.getByRole('button', { name: 'Start upgrade process' }).click();
        await expect(app.page.getByText('Vault upgrade successful.')).toBeVisible();
        await app.page.locator('#upgrade-continue-button').click();
        await app.expectVaultOpen(testUser.username);
      });

      await test.step('the second session starts the upgrade too and takes the upgraded vault', async () => {
        await other.pause();
        await other.page.getByRole('button', { name: 'Start upgrade process' }).click();
        if (!runsLegacyDatabaseUpgrade) {
          // The storage format step ran here as well, so this session confirms it like the first one did.
          await expect(other.page.getByText('Vault upgrade successful.')).toBeVisible();
          await other.page.locator('#upgrade-continue-button').click();
        }
        await other.expectVaultOpen(testUser.username);
      });

      await test.step('both sessions show the vault', async () => {
        for (const session of [app, other]) {
          await session.openVault();
          for (const name of fixture.expectedItemNames) {
            await expect(session.page.getByText(name, { exact: true }).first()).toBeVisible();
          }
        }
      });

      await test.step('the second session can save to the upgraded vault', async () => {
        await other.createItem('Saved by the second session');
        await app.page.reload();
        await app.page.locator('#password').fill(fixture.password);
        await app.page.locator('#unlock-button').click();
        await app.openVault();
        await expect(app.page.getByText('Saved by the second session', { exact: true })).toBeVisible();
      });
    });
  }
});
