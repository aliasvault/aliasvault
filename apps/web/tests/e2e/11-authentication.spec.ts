/**
 * Category 11: Authentication (requires API)
 */
import { test, expect } from '../fixtures';
import { createTestUser, TEST_LOGIN_RATE_LIMIT_BUCKET_HEADER, TEST_LOGIN_RATE_LIMIT_HEADER } from '../helpers/test-api';

import type { Page } from '@playwright/test';

/**
 * Whether the auto-lock has started, which stores the return URL before it locks the vault.
 */
const autoLockStarted = async (page: Page): Promise<boolean> => (await page.evaluate(() => localStorage.getItem('returnUrl'))) !== null;

test.describe('11. Authentication', () => {
  test('11.1 should log in and log out', async ({ app, testUser }) => {
    await test.step('log in', async () => {
      await app.login(testUser.username, testUser.password);
      await expect(app.page.getByText('No items yet')).toBeVisible();
    });

    await test.step('log out', async () => {
      await app.logout();
    });

    await test.step('logged out visitors are sent to the start page', async () => {
      await app.page.goto('/items');
      await expect(app.page).toHaveURL(/\/user\/start$/);
    });
  });

  test('11.2 should reject invalid credentials', async ({ app, credentials }) => {
    await app.page.goto('/user/login');
    await app.page.locator('#email').fill(credentials.username);
    await app.page.locator('#password').fill(credentials.password);
    await app.page.locator('#login-button').click();

    await expect(app.page.getByText('Invalid username or password')).toBeVisible();
    await expect(app.page).toHaveURL(/\/user\/login$/);
  });

  test('11.3 should return to the open page after unlocking a reloaded vault', async ({ app, testUser }) => {
    const { page } = app;
    await app.login(testUser.username, testUser.password);
    await app.createItem('Return after unlock');
    const itemUrl = page.url();

    await test.step('reloading locks the vault', async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/unlock$/);
    });

    await test.step('unlocking returns to the item', async () => {
      await page.locator('#password').fill(testUser.password);
      await page.locator('#unlock-button').click();
      await expect(page).toHaveURL(itemUrl);
      await app.expectItemView('Return after unlock');
    });
  });

  test('11.4 should refuse every v1 endpoint for a v2 account', async ({ apiUrl, testUser }) => {
    /**
     * Call a v1 endpoint, authenticated as the test user unless the token is null.
     */
    const v1 = (method: string, path: string, body?: unknown, token: string | null = testUser.token): Promise<Response> => fetch(`${apiUrl}/v1/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    await test.step('the status endpoint answers, reporting the client as unsupported', async () => {
      const status = await v1('GET', 'Auth/status');
      expect(status.status).toBe(200);
      expect(((await status.json()) as { clientVersionSupported: boolean }).clientVersionSupported).toBe(false);
    });

    await test.step('authenticated endpoints are refused', async () => {
      const requests: [string, string, unknown?][] = [
        ['GET', 'Vault'],
        ['GET', 'Auth/change-password/initiate'],
        ['GET', 'TwoFactorAuth/status'],
        ['POST', 'TwoFactorAuth/enable'],
        ['POST', 'TwoFactorAuth/disable', '000000'],
        ['GET', 'Security/sessions'],
        ['GET', 'Security/authlogs'],
        ['GET', 'EmailBox/test@example.com'],
        ['GET', 'Email/1'],
        ['DELETE', 'Email/1'],
        ['POST', 'Identity/CheckEmail/test@example.com'],
        ['GET', 'Favicon/Extract?url=https://example.com'],
      ];
      for (const [method, path, body] of requests) {
        expect((await v1(method, path, body)).status, `${method} /v1/${path}`).toBe(426);
      }
    });

    await test.step('sign-in endpoints are refused', async () => {
      const proof = { username: testUser.username, clientPublicEphemeral: 'aa', clientSessionProof: 'aa', rememberMe: false };
      expect((await v1('POST', 'Auth/login', { username: testUser.username }, null)).status).toBe(426);
      expect((await v1('POST', 'Auth/validate', proof, null)).status).toBe(426);
      expect((await v1('POST', 'Auth/validate-2fa', { ...proof, code2Fa: 123456 }, null)).status).toBe(426);
      expect((await v1('POST', 'Auth/refresh', { token: testUser.token, refreshToken: 'unknown' }, null)).status).toBe(426);
    });

    await test.step('logging out still works', async () => {
      expect((await v1('POST', 'Auth/revoke', { token: testUser.token, refreshToken: 'unknown' }, null)).status).toBe(200);
    });
  });

  test('11.5 should limit the logins one IP starts across accounts', async ({ app, apiUrl, testUser, newApp }) => {
    const { page } = app;
    const loginLimit = 15;
    const lockoutAfter = 10;
    const otherUser = await createTestUser(apiUrl);
    await page.context().setExtraHTTPHeaders({ [TEST_LOGIN_RATE_LIMIT_HEADER]: String(loginLimit), [TEST_LOGIN_RATE_LIMIT_BUCKET_HEADER]: crypto.randomUUID() });

    /**
     * Submit the login form and return the status of the login request it starts.
     */
    const attempt = async (username: string, password: string): Promise<number> => {
      const response = page.waitForResponse((r) => /\/v2\/Auth\/login$/i.test(r.url()) && r.request().method() === 'POST');
      await app.submitLogin(username, password);
      return (await response).status();
    };

    await page.goto('/user/login');

    await test.step('wrong passwords lock the first account', async () => {
      for (let i = 0; i < lockoutAfter; i++) {
        expect(await attempt(testUser.username, 'wrong-password')).toBe(200);
        await expect(page.getByText(/Invalid username or password|Account temporarily locked/)).toBeVisible();
        await expect(page.locator('#login-button')).toBeEnabled();
      }
    });

    await test.step('the locked account is refused, even with its password', async () => {
      for (let i = lockoutAfter; i < loginLimit; i++) {
        expect(await attempt(testUser.username, testUser.password)).toBe(400);
        await expect(page.getByText('Account temporarily locked')).toBeVisible();
        await expect(page.locator('#login-button')).toBeEnabled();
      }
    });

    await test.step('a second account from the same IP is refused by the rate limit', async () => {
      expect(await attempt(otherUser.username, otherUser.password)).toBe(429);
      await expect(page).toHaveURL(/\/user\/login$/);
    });

    await test.step('the second account logs in outside the limited bucket', async () => {
      const other = await newApp();
      await other.login(otherUser.username, otherUser.password);
    });
  });

  test('11.6 should auto-lock an idle vault and return to the open page after unlocking', async ({ app, testUser }) => {
    const { page } = app;
    await page.clock.install();
    await app.login(testUser.username, testUser.password);

    await test.step('the timeout defaults to 1 hour and can be shortened to 1 minute', async () => {
      await app.openSettingsPage('Auto-lock Timeout');
      await expect(page).toHaveURL(/\/settings\/security\/auto-lock$/);
      await expect(page.locator('#autoLockTimeout')).toHaveValue('3600');
      await page.locator('#autoLockTimeout').selectOption('60');
    });

    await test.step('the vault stays open before the timeout passes', async () => {
      await page.clock.runFor('00:50');
      expect(await autoLockStarted(page)).toBe(false);
    });

    await test.step('the vault locks once the timeout passes without input', async () => {
      await page.clock.runFor('00:20');
      await expect(page).toHaveURL(/\/unlock\/true$/);
    });

    await test.step('unlocking returns to the settings page', async () => {
      await page.locator('#password').fill(testUser.password);
      await page.locator('#unlock-button').click();
      await expect(page).toHaveURL(/\/settings\/security\/auto-lock$/);
      await expect(page.locator('#autoLockTimeout')).toHaveValue('60');
    });
  });

  test('11.7 should restart the auto-lock timeout on user input', async ({ app, testUser }) => {
    const { page } = app;
    await page.clock.install();
    await app.login(testUser.username, testUser.password);
    await app.openSettingsPage('Auto-lock Timeout');
    await page.locator('#autoLockTimeout').selectOption('60');

    await test.step('input halfway the timeout keeps the vault open past it', async () => {
      await page.clock.runFor('00:30');
      await page.keyboard.press('Shift');
      await page.clock.runFor('00:40');
      expect(await autoLockStarted(page)).toBe(false);
    });

    await test.step('the vault locks once the timeout passes after the last input', async () => {
      await page.clock.runFor('00:30');
      await expect(page).toHaveURL(/\/unlock\/true$/);
    });
  });
});
