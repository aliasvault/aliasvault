/**
 * Category 2: UI Navigation (No API required)
 *
 * These tests verify UI navigation works without needing authentication.
 * They don't require an API server to be running.
 */
import { test, expect, TestClient } from '../fixtures';

test.describe.serial('2. UI Navigation', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('2.1 should have working settings button', async ({ context, extensionId }) => {
    client = await TestClient.fromContext(context, extensionId);

    await client
      .openLoginSettings()
      .then((c) => c.screenshot('2.1-settings-navigation.png'));

    const backButton = client.popup.locator('button#back');
    await expect(backButton).toBeVisible();

    await client.backToLogin();
    await expect(client.popup.locator('input[type="text"]')).toBeVisible();
  });

  test('2.2 should allow configuring custom API URL', async ({ apiUrl }) => {
    await client.configureApiUrl(apiUrl);

    await expect(client.popup.locator('input[type="text"]')).toBeVisible();
    await expect(client.popup.locator('input[type="password"]')).toBeVisible();

    await client.screenshot('2.2-api-configured.png');
  });
});
