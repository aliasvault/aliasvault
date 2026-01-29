/**
 * Category 1: Extension Loading (No API required)
 *
 * These tests verify the extension loads and renders correctly.
 * They don't require an API server to be running.
 */
import { test, expect, TestClient } from '../fixtures';

test.describe.serial('1. Extension Loading', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('1.1 should load the popup and show login form', async ({ context, extensionId }) => {
    client = await TestClient.fromContext(context, extensionId);

    const appContent = client.popup.locator('#root');
    await expect(appContent).toBeVisible();

    await expect(client.popup.locator('input[type="text"]')).toBeVisible();
    await expect(client.popup.locator('input[type="password"]')).toBeVisible();

    await client.screenshot('1.1-popup-loaded.png');
  });

  test('1.2 should have a running service worker', async ({ context, extensionId }) => {
    const serviceWorkers = context.serviceWorkers();
    expect(serviceWorkers.length).toBeGreaterThan(0);

    const swUrl = serviceWorkers[0].url();
    expect(swUrl).toContain(extensionId);
    expect(swUrl).toContain('background');
  });
});
