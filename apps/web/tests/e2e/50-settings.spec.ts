/**
 * Category 50: Settings (requires API)
 */
import { test, expect, type WebApp } from '../fixtures';
import { getKeyState } from '../helpers/test-api';

import type { Locator } from '@playwright/test';

const ROTATED_PASSWORD = 'TestPass_e2e_rotated!';
const ROTATION_SUCCESS_MESSAGE = 'Password changed successfully';
const ROTATION_OUTDATED_MESSAGE = 'Your vault is not up-to-date. Please synchronize your vault and try again.';
const PASSWORD_CHANGED_MESSAGE = 'Your password has changed since the last time you logged in. Please login again for security reasons.';

/**
 * The submit button of the change password page while key rotation is ticked.
 */
function rotateButton(app: WebApp): Locator {
  return app.page.getByRole('button', { name: 'Change password and rotate keys' });
}

/**
 * Open the change master password page, fill in the passwords and tick and acknowledge the key rotation option.
 */
async function prepareKeyRotation(app: WebApp, currentPassword: string, newPassword: string): Promise<void> {
  await app.openSettingsPage('Change Master Password');
  await expect(app.page).toHaveURL(/\/settings\/security\/change-password$/);
  await app.page.locator('#currentPassword').fill(currentPassword);
  await app.page.locator('#newPassword').fill(newPassword);
  await app.page.locator('#newPasswordConfirm').fill(newPassword);
  await expect(app.page.getByRole('button', { name: 'Change Password', exact: true })).toBeEnabled();

  await app.page.getByRole('button', { name: 'Advanced settings' }).click();
  await app.page.getByLabel('Also rotate all encryption keys').check();
  await expect(app.page.getByText('This is a high-risk action.')).toBeVisible();
  await expect(rotateButton(app)).toBeDisabled();
  await app.page.getByLabel('I have backed up my vault and signed out of my other devices').check();
  await expect(rotateButton(app)).toBeEnabled();
}

/**
 * Create an item via the quick create dialog without waiting for the result, so the test can watch what the push does.
 */
async function startCreatingItem(app: WebApp, name: string): Promise<void> {
  await app.page.locator('#topBarQuickCreateButton').click();
  await app.page.locator('#serviceName').fill(name);
  await app.page.locator('#quickIdentitySubmit').click();
  await expect(app.page.locator('#service-name')).toHaveValue(name);
  await app.saveItemButton().click();
}

test.describe('50. Settings', () => {
  test('50.1 should keep the app language in the vault', async ({ app, testUser }) => {
    const { page } = app;
    /**
     * The Emails link of the top menu, by its translated name.
     */
    const emailsLink = (name: string): Locator => page.getByRole('link', { name, exact: true }).first();
    await app.login(testUser.username, testUser.password);

    await test.step('switch to Dutch', async () => {
      await page.locator('#userMenuButton').click();
      await page.locator('#userMenu').getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('main').getByRole('link', { name: 'General settings' }).click();
      await page.locator('#appLanguage').selectOption('nl');
      await expect(emailsLink('E-mails')).toBeVisible();
    });

    await test.step('a reload keeps Dutch', async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/unlock$/);
      await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible();
      await page.locator('#password').fill(testUser.password);
      await page.getByRole('button', { name: 'Ontgrendelen' }).click();
      await expect(page).toHaveURL(/\/settings\/general$/);
      await expect(emailsLink('E-mails')).toBeVisible();
    });

    await test.step('a browser without local preferences takes the language from the vault', async () => {
      await page.goto('/user/logout');
      await expect(page).toHaveURL(/\/user\/start$/);
      await page.evaluate(() => localStorage.clear());
      await app.login(testUser.username, testUser.password);
      await expect(emailsLink('E-mails')).toBeVisible();
    });
  });

  test('50.2 should rotate the encryption keys with the password change and sign out another device', async ({ app, newApp, apiUrl, testUser }) => {
    const other = await newApp();
    await app.login(testUser.username, testUser.password);
    await other.login(testUser.username, testUser.password);

    await test.step('both devices hold the vault with an item', async () => {
      await app.createItem('Before rotation');
      await expect(async () => {
        await other.page.getByRole('button', { name: 'Refresh' }).click();
        await expect(other.page.getByText('Before rotation', { exact: true })).toBeVisible({ timeout: 2000 });
      }).toPass();
    });

    const before = await getKeyState(apiUrl, testUser.username);
    expect(before.activeSessions).toBeGreaterThan(1);

    await test.step('the password is changed with the keys rotated', async () => {
      await prepareKeyRotation(app, testUser.password, ROTATED_PASSWORD);
      await app.pause();
      await rotateButton(app).click();
      await expect(app.page.getByText(ROTATION_SUCCESS_MESSAGE)).toBeVisible();
      await expect(app.page).toHaveURL(/\/settings$/);
      await app.pause();
    });

    const after = await getKeyState(apiUrl, testUser.username);
    await test.step('the server holds the vault under new keys, for this session only', async () => {
      expect(after.accountKeyVersion).toBe(before.accountKeyVersion + 1);
      expect(after.manifestKeyVersion).toBe(before.manifestKeyVersion + 1);
      expect(after.manifestRevision).toBe(before.manifestRevision + 1);
      expect(after.personalVekVersions).toEqual([after.manifestKeyVersion]);
      expect(after.accountPublicKey).not.toBe(before.accountPublicKey);
      expect(after.signingPublicKey).not.toBe(before.signingPublicKey);
      expect(after.srpSalt).not.toBe(before.srpSalt);
      expect(after.activeSessions).toBe(1);
    });

    await test.step('this device reads and writes the vault with the new keys', async () => {
      await app.openVault();
      await expect(app.page.getByText('Before rotation', { exact: true })).toBeVisible();
      await app.createItem('After rotation');
      expect((await getKeyState(apiUrl, testUser.username)).manifestRevision).toBeGreaterThan(after.manifestRevision);
    });

    await test.step('after a reload the vault unlocks with the new password', async () => {
      const itemUrl = app.page.url();
      await app.page.reload();
      await expect(app.page).toHaveURL(/\/unlock$/);
      await app.page.locator('#password').fill(ROTATED_PASSWORD);
      await app.page.locator('#unlock-button').click();
      await expect(app.page).toHaveURL(itemUrl);
      await app.expectItemView('After rotation');
      await app.pause();
    });

    const written = (await getKeyState(apiUrl, testUser.username)).manifestRevision;
    await test.step('the other device, whose access token is still valid, is signed out instead of writing with the old keys', async () => {
      await startCreatingItem(other, 'Written with the old keys');
      await expect(other.page).toHaveURL(/\/user\/login$/);
      await expect(other.page.getByText(PASSWORD_CHANGED_MESSAGE)).toBeVisible();
      expect((await getKeyState(apiUrl, testUser.username)).manifestRevision).toBe(written);
      await other.pause();
    });

    await test.step('the other device logs in again with the new password only', async () => {
      await other.submitLogin(testUser.username, testUser.password);
      await expect(other.page.getByText('Invalid username or password')).toBeVisible();

      await other.page.locator('#password').fill(ROTATED_PASSWORD);
      await other.page.locator('#login-button').click();
      await expect(other.page.locator('#userMenu').getByText(testUser.username, { exact: true })).toBeAttached();
      await other.openVault();
      await expect(other.page.getByText('After rotation', { exact: true })).toBeVisible();
      await expect(other.page.getByText('Written with the old keys')).toHaveCount(0);
      await other.pause();
    });
  });

  test('50.3 should refuse a rotation when another device writes meanwhile, and apply it on retry', async ({ app, newApp, apiUrl, testUser }) => {
    const other = await newApp();
    await app.login(testUser.username, testUser.password);
    await other.login(testUser.username, testUser.password);
    const before = await getKeyState(apiUrl, testUser.username);

    await test.step('another device writes while the rotation request is on its way', async () => {
      // Hold the rotation request until the other device has pushed, so the server sees a vault that moved on.
      await app.page.route('**/v2/KeyRotation', async (route) => {
        await other.createItem('Written during the rotation');
        await route.continue();
      }, { times: 1 });

      await prepareKeyRotation(app, testUser.password, ROTATED_PASSWORD);
      await rotateButton(app).click();
      await expect(app.page.getByText(ROTATION_OUTDATED_MESSAGE)).toBeVisible();
      await app.pause();
    });

    await test.step('the refused rotation changed nothing', async () => {
      const unchanged = await getKeyState(apiUrl, testUser.username);
      expect(unchanged.accountKeyVersion).toBe(before.accountKeyVersion);
      expect(unchanged.manifestKeyVersion).toBe(before.manifestKeyVersion);
      expect(unchanged.accountPublicKey).toBe(before.accountPublicKey);
      expect(unchanged.srpSalt).toBe(before.srpSalt);
      expect(unchanged.activeSessions).toBe(before.activeSessions);
    });

    await test.step('the retry pulls the other device\'s change first and goes through', async () => {
      await rotateButton(app).click();
      await expect(app.page.getByText(ROTATION_SUCCESS_MESSAGE)).toBeVisible();
      await app.openVault();
      await expect(app.page.getByText('Written during the rotation', { exact: true })).toBeVisible();

      const after = await getKeyState(apiUrl, testUser.username);
      expect(after.accountKeyVersion).toBe(before.accountKeyVersion + 1);
      expect(after.manifestKeyVersion).toBe(before.manifestKeyVersion + 1);
      expect(after.activeSessions).toBe(1);
      await app.pause();
    });
  });
});
