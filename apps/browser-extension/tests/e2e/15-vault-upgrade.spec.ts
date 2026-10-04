/**
 * Category 15: Vault upgrades from older versions.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as OTPAuth from 'otpauth';

import { test, expect, TestClient, Timeouts } from '../fixtures';
import { readLegacyVaultFixture, restoreLegacyVault, type LegacyVaultFixture, type LegacyVaultItem } from '../helpers/test-api';

/**
 * Escape a text for use inside a regular expression.
 */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Run the storage format upgrade from the upgrade page the popup shows after login, ending in the unlocked popup.
 */
async function upgradeStorageFormat(client: TestClient): Promise<void> {
  const { popup } = client;
  await expect(popup.getByText('your other AliasVault apps need version')).toBeVisible({ timeout: Timeouts.LONG });
  await client.pause();
  await popup.locator('button#upgrade-button').click();
  // The success screen continues on its own after a countdown.
  const continueButton = popup.locator('button#upgrade-continue-button');
  await popup.locator('button#upgrade-continue-button, #nav-vault').first().waitFor({ state: 'visible', timeout: Timeouts.LONG });
  if (await continueButton.isVisible()) {
    await client.pause();
    if (await continueButton.isVisible()) {
      await continueButton.click();
    }
  }
}

/**
 * Open the details page of a legacy vault item from the vault list, going through its folders.
 */
async function openLegacyItem(client: TestClient, item: LegacyVaultItem): Promise<void> {
  const { popup } = client;
  await client.goToVault();
  for (const folder of item.folderPath) {
    await popup.getByRole('option', { name: new RegExp(`^${escapeRegExp(folder)} \\d+$`) }).click();
    await expect(popup.getByRole('heading', { name: new RegExp(`^${escapeRegExp(folder)} \\(`) })).toBeVisible();
  }
  await popup.getByText(item.name, { exact: true }).first().click();
  await expect(popup.getByRole('heading', { name: item.name, exact: true, level: 1 })).toBeVisible();
}

/**
 * Check that the open details page shows everything the legacy vault holds for the item.
 */
async function expectLegacyItemContent(client: TestClient, item: LegacyVaultItem): Promise<void> {
  const { popup } = client;
  const main = popup.getByRole('main');

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
      await expect(main.locator(`[id="${field.key}"]`)).toHaveValue(field.value);
    }
  }

  for (const field of item.customFields) {
    if (field.type === 'URL') {
      // A custom URL field shows as a link next to the item's own URLs, without its label.
      await expect(main.getByRole('link', { name: field.value, exact: true })).toBeVisible();
      continue;
    }
    await expect(main.getByText(field.label, { exact: true })).toBeVisible();
    if (field.type === 'TextArea') {
      await expect(main.getByText(field.value, { exact: true })).toBeVisible();
    } else {
      await expect(main.getByLabel(field.label, { exact: true })).toHaveValue(field.value);
    }
  }

  for (const totpCode of item.totpCodes) {
    // The shown code proves the secret: it is the code of this or (around a period change) the previous or next 30 seconds.
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(totpCode.secretKey) });
    const tile = main.getByRole('button', { name: `Copy ${totpCode.name} code`, exact: true });
    await expect(async () => {
      const shown = ((await tile.textContent()) ?? '').replace(totpCode.name, '').replace(/\D/g, '').slice(0, 6);
      expect([-30000, 0, 30000].map(offset => totp.generate({ timestamp: Date.now() + offset }))).toContain(shown);
    }).toPass();
  }

  for (const attachment of item.attachments) {
    const tile = main.getByRole('button', { name: `Download ${attachment.filename}`, exact: true });
    const [download] = await Promise.all([popup.waitForEvent('download'), tile.click()]);
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
    const history = popup.locator('input[id^="history-"]');
    await expect(history).toHaveCount(item.passwordHistory.length);
    // Newest first.
    const shown = await history.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
    expect(shown).toEqual([...item.passwordHistory].reverse());
    await popup.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(history).toHaveCount(0);
  }

  // What was removed in the old client stays removed.
  for (const removed of [...(item.removed?.customFields ?? []), ...(item.removed?.totpCodes ?? []), ...(item.removed?.attachments ?? [])]) {
    await expect(main.getByText(removed, { exact: true })).toHaveCount(0);
  }
}

/**
 * Check that the unlocked popup shows everything a legacy vault fixture holds: items, folders, trash and settings.
 */
async function expectLegacyVaultContent(client: TestClient, fixture: LegacyVaultFixture): Promise<void> {
  const { popup } = client;
  const content = fixture.expected;
  if (!content) {
    throw new Error('The legacy vault fixture does not list its content.');
  }

  await test.step('the vault list shows the items outside folders only', async () => {
    await client.goToVault();
    for (const name of fixture.expectedItemNames) {
      await expect(popup.getByText(name, { exact: true }).first()).toBeVisible();
    }
    const notListed = [...content.items.filter(item => item.folderPath.length > 0), ...content.trashedItems].map(item => item.name);
    for (const name of [...notListed, ...content.purgedItemNames, ...content.deletedFolderNames]) {
      await expect(popup.getByText(name, { exact: true })).toHaveCount(0);
    }
  });

  for (const item of content.items) {
    await test.step(`item "${item.name}" is complete`, async () => {
      await openLegacyItem(client, item);
      await expectLegacyItemContent(client, item);
    });
  }

  await test.step('the trash holds the trashed items, not the permanently deleted ones', async () => {
    await client.goToVault();
    await popup.getByRole('button', { name: /^Items \(/ }).click();
    await popup.getByRole('button', { name: /^Recently Deleted/ }).click();
    for (const item of content.trashedItems) {
      await expect(popup.getByText(item.name, { exact: true })).toBeVisible();
    }
    for (const name of content.purgedItemNames) {
      await expect(popup.getByText(name, { exact: true })).toHaveCount(0);
    }
  });

  await test.step('the identity generator settings are kept', async () => {
    await popup.evaluate(() => {
      window.location.hash = '#/settings/identity-generator';
    });
    const selects = popup.getByRole('main').locator('select');
    await expect(selects).toHaveCount(3);
    await expect(selects.nth(0)).toHaveValue(content.settings.DefaultIdentityLanguage);
    await expect(selects.nth(1)).toHaveValue(content.settings.DefaultIdentityGender);
    await expect(selects.nth(2)).toHaveValue(content.settings.DefaultIdentityAgeRange);
  });
}

test.describe.serial('15. Vault upgrades', () => {
  const clients: TestClient[] = [];
  let client: TestClient;

  test.afterAll(async () => {
    await Promise.all(clients.map(c => c.cleanup()));
  });

  test('15.1 should upgrade a 0.1.0 vault to the current storage format', async ({ testUser, apiUrl }) => {
    const fixture = readLegacyVaultFixture('0.1.0');
    await restoreLegacyVault(apiUrl, testUser.username, fixture);

    client = await TestClient.create();
    clients.push(client);
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
      await upgradeStorageFormat(client);
    });

    await test.step('the items of the 0.1.0 vault are there', async () => {
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

  test('15.2 should keep everything a 0.30.7 vault holds when upgrading it', async ({ testUser, apiUrl }) => {
    test.slow();
    const fixture = readLegacyVaultFixture('0.30.7');
    await restoreLegacyVault(apiUrl, testUser.username, fixture);

    client = await TestClient.create();
    clients.push(client);
    await client.configureApiUrl(apiUrl);
    await client.attemptLogin(testUser.username, fixture.password);

    // A 0.30.7 vault is on database version 2.0.0, so there is no legacy database upgrade to run first.
    await test.step('run the storage format upgrade', async () => {
      await upgradeStorageFormat(client);
    });

    await test.step('the upgraded vault shows what the 0.30.7 clients stored', async () => {
      await expectLegacyVaultContent(client, fixture);
    });

    await test.step('another browser that logs in reads the same vault back from the server', async () => {
      const other = await TestClient.create();
      clients.push(other);
      await other.login(apiUrl, testUser.username, fixture.password);
      await expectLegacyVaultContent(other, fixture);
    });
  });
});
