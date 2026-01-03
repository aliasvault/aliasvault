/**
 * Category 3: Authentication Flow (Requires API)
 *
 * These tests verify login/authentication works correctly.
 * They require an API server to be running at localhost:5092.
 */
import { test, expect, TestClient } from '../fixtures';

test.describe.serial('3. Authentication Flow', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('3.1 should display error for invalid credentials', async ({ context, extensionId, apiUrl }) => {
    client = await TestClient.fromContext(context, extensionId);
    await client.configureApiUrl(apiUrl);

    await client
      .attemptLogin('nonexistent@example.tld', 'wrongpassword')
      .then((c) => c.screenshot('3.1-login-failed.png'));

    await expect(client.popup.locator('text=Invalid username or password')).toBeVisible({ timeout: 10000 });

    await client.clearLoginForm();
  });

  test('3.2 should successfully login with valid credentials', async ({ testUser }) => {
    await client
      .fillLoginForm(testUser.username, testUser.password)
      .then((c) => c.submitLogin())
      .then((c) => c.screenshot('3.2-login-success.png'));
  });
});
