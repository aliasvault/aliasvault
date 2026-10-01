/**
 * Category 8: Two-factor authentication (requires API)
 */
import * as OTPAuth from 'otpauth';

import { test, expect, type WebApp } from '../fixtures';
import { postTwoFactorAuth } from '../helpers/test-api';

/**
 * The authenticator an enabled account is set up with, plus its recovery codes.
 */
type TwoFactorSetup = {
  totp: OTPAuth.TOTP;
  recoveryCodes: string[];
};

/**
 * Open the security settings page via the user menu; a full page load would lock the vault.
 */
async function openSecuritySettings(app: WebApp): Promise<void> {
  await app.page.locator('#toggleMobileMenuButton').click();
  await app.page.locator('#mobileMenuDropdown').getByRole('link', { name: 'Security settings' }).click();
  await expect(app.page).toHaveURL(/\/settings\/security$/);
}

/**
 * Enable two-factor authentication through the settings pages and return the authenticator and recovery codes.
 */
async function enableTwoFactor(app: WebApp): Promise<TwoFactorSetup> {
  const { page } = app;
  await openSecuritySettings(app);
  await page.getByRole('button', { name: 'Enable two-factor authentication', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/security\/enable-2fa$/);

  await expect(page.locator('#authenticator-uri img')).toBeVisible();
  const secret = (await page.locator('#authenticator-secret').innerText()).replace(/\s/g, '').toUpperCase();
  expect(secret).not.toBe('');
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });

  await page.locator('#verificationCode').fill(totp.generate());
  await page.getByRole('button', { name: 'Verify and Enable' }).click();
  await expect(page.getByText('Two-factor authentication is now successfully enabled.')).toBeVisible();

  const codes = page.locator('#recovery-codes code');
  await expect(codes).toHaveCount(10);
  return { totp, recoveryCodes: await codes.allInnerTexts() };
}

/**
 * Log out and submit the login form, stopping at the two-factor step.
 */
async function loginUntilTwoFactor(app: WebApp, username: string, password: string): Promise<void> {
  await app.logout();
  await app.submitLogin(username, password);
  await expect(app.page.locator('#two-factor-code')).toBeVisible();
}

/**
 * Open the disable page and submit the given code, without waiting for the result.
 */
async function submitDisableCode(app: WebApp, code: string): Promise<void> {
  const { page } = app;
  if (!page.url().endsWith('/settings/security/disable-2fa')) {
    await openSecuritySettings(app);
    await page.getByRole('button', { name: 'Disable two-factor authentication', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/security\/disable-2fa$/);
  }
  await page.locator('#disableCode').fill(code);
  await page.getByRole('button', { name: 'Confirm Disable Two-Factor Authentication' }).click();
}

/**
 * Wait until two-factor is off and the security page offers to enable it again.
 */
async function expectTwoFactorDisabled(app: WebApp): Promise<void> {
  await expect(app.page).toHaveURL(/\/settings\/security$/);
  await expect(app.page.getByText('Two-factor authentication is now successfully disabled.')).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Enable two-factor authentication', exact: true })).toBeVisible();
}

/**
 * A code the authenticator does not produce right now.
 */
function wrongCode(totp: OTPAuth.TOTP): string {
  return String((Number(totp.generate()) + 500000) % 1000000).padStart(6, '0');
}

test.describe('8. Two-factor authentication', () => {
  test('8.1 should enable 2FA, log in with an authenticator code and disable it again', async ({ app, testUser, apiUrl }) => {
    const { page } = app;
    await app.login(testUser.username, testUser.password);
    const { totp } = await enableTwoFactor(app);

    await test.step('the API no longer hands out the key or restarts setup once 2FA is on', async () => {
      const enable = await postTwoFactorAuth(apiUrl, testUser.token, 'enable');
      expect(enable.status).toBe(400);
      expect(await enable.text()).not.toContain(totp.secret.base32);
      expect((await postTwoFactorAuth(apiUrl, testUser.token, 'verify', totp.generate())).status).toBe(400);
    });

    await test.step('the API refuses to disable 2FA without a code', async () => {
      expect((await postTwoFactorAuth(apiUrl, testUser.token, 'disable', '')).status).toBe(400);
    });

    await test.step('log in with an authenticator code', async () => {
      await loginUntilTwoFactor(app, testUser.username, testUser.password);
      await page.locator('#two-factor-code').fill(totp.generate());
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await app.expectVaultOpen(testUser.username);
    });

    await test.step('a wrong authenticator code does not disable 2FA', async () => {
      await submitDisableCode(app, wrongCode(totp));
      await expect(page.getByText('Invalid authenticator code. Please try again.')).toBeVisible();
      await expect(page).toHaveURL(/\/settings\/security\/disable-2fa$/);
    });

    await test.step('a current authenticator code disables 2FA', async () => {
      await submitDisableCode(app, totp.generate());
      await expectTwoFactorDisabled(app);
    });

    await test.step('log in with only the password', async () => {
      await app.logout();
      await app.login(testUser.username, testUser.password);
    });
  });

  test('8.2 should log in with a recovery code and disable 2FA with another one', async ({ app, testUser }) => {
    const { page } = app;
    await app.login(testUser.username, testUser.password);
    const { recoveryCodes } = await enableTwoFactor(app);

    await test.step('log in with a recovery code', async () => {
      await loginUntilTwoFactor(app, testUser.username, testUser.password);
      await page.getByRole('button', { name: 'Log in with a recovery code instead.' }).click();
      await page.locator('#recovery-code').fill(recoveryCodes[0]);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await app.expectVaultOpen(testUser.username);
    });

    await test.step('a used recovery code does not disable 2FA', async () => {
      await submitDisableCode(app, recoveryCodes[0]);
      await expect(page.getByText('Invalid recovery code. Please try again.')).toBeVisible();
    });

    await test.step('an unused recovery code disables 2FA', async () => {
      await submitDisableCode(app, recoveryCodes[1]);
      await expectTwoFactorDisabled(app);
    });
  });
});
