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

  test('1.3 should override navigator.credentials on web pages', async ({ context }) => {
    const page = await context.newPage();
    await page.route('https://webauthn-test-domain.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WebAuthn</title>' }));
    await page.goto('https://webauthn-test-domain.com/');

    const patched = await page.evaluate(() => {
      const isPatched = (fn: unknown): boolean => (fn as { __aliasVaultPatched?: boolean }).__aliasVaultPatched === true;
      return { get: isPatched(navigator.credentials.get), create: isPatched(navigator.credentials.create) };
    });
    expect(patched).toEqual({ get: true, create: true });

    await page.close();
  });
});
