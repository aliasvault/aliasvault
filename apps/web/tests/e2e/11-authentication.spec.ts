/**
 * Category 11: Authentication (requires API)
 */
import { test, expect } from '../fixtures';

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
});
