/**
 * Category 10: Two-Factor Authentication State Persistence
 *
 * These tests verify that the 2FA login state persists when the popup is closed
 * and reopened, allowing users to switch to their authenticator app without
 * losing their login progress.
 *
 * Test scenarios:
 * 1. 2FA prompt appears after entering valid credentials for 2FA-enabled user
 * 2. State persists across popup close/reopen (simulated via page navigation)
 * 3. Cancel button clears the state and returns to login form
 * 4. Successfully complete login with valid 2FA code
 */
import { test, expect, TestClient } from '../fixtures';
import { createTestUserWith2FA, generateTotpCode, type TestUser } from '../helpers/test-api';

/**
 * Helper to check if the 2FA form is visible.
 */
async function isTwoFactorFormVisible(client: TestClient): Promise<boolean> {
  return client.popup.locator('input#twoFactorCode').isVisible({ timeout: 2000 }).catch(() => false);
}

/**
 * Helper to check if the login form is visible.
 */
async function isLoginFormVisible(client: TestClient): Promise<boolean> {
  return client.popup.locator('input#username').isVisible({ timeout: 2000 }).catch(() => false);
}

/**
 * Helper to close and reopen the popup by navigating away and back.
 */
async function reopenPopup(client: TestClient): Promise<void> {
  await client.popup.evaluate(() => {
    window.location.href = '/popup.html';
  });
  await client.popup.waitForLoadState('networkidle');
  await client.popup.waitForTimeout(500);
}

test.describe.serial('10. Two-Factor Authentication State', () => {
  let client: TestClient;
  let twoFactorUser: TestUser;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('10.1 should show 2FA form after entering credentials for 2FA-enabled user', async ({ apiUrl }) => {
    // Create a test user with 2FA enabled
    twoFactorUser = await createTestUserWith2FA(apiUrl);

    client = await TestClient.create();
    await client.configureApiUrl(apiUrl);

    // Verify we start on the login form
    const loginVisible = await isLoginFormVisible(client);
    expect(loginVisible).toBe(true);

    await client.screenshot('10.1-initial-login-form.png');

    // Enter credentials for 2FA-enabled user and submit
    await client.popup.fill('input#username', twoFactorUser.username);
    await client.popup.fill('input#password', twoFactorUser.password);
    await client.popup.click('button:has-text("Log in")');

    // Wait for 2FA form to appear
    await client.popup.waitForSelector('input#twoFactorCode', { state: 'visible', timeout: 15000 });

    // Verify 2FA form is visible
    const twoFactorVisible = await isTwoFactorFormVisible(client);
    expect(twoFactorVisible).toBe(true);

    await client.screenshot('10.1-2fa-form-visible.png');
  });

  test('10.2 should persist 2FA state across popup close/reopen', async () => {
    // Reopen the popup (simulates closing and reopening)
    await reopenPopup(client);

    // Wait for the page to load and check for 2FA form
    await client.popup.waitForTimeout(500);

    // Verify 2FA form is still visible (state was restored)
    const twoFactorVisible = await isTwoFactorFormVisible(client);
    expect(twoFactorVisible).toBe(true);

    // Verify the 2FA code input is present and functional
    const codeInput = client.popup.locator('input#twoFactorCode');
    await expect(codeInput).toBeVisible();

    // Verify the Verify button is present
    const verifyButton = client.popup.locator('button:has-text("Verify")');
    await expect(verifyButton).toBeVisible();

    // Verify the Cancel button is present
    const cancelButton = client.popup.locator('button:has-text("Cancel")');
    await expect(cancelButton).toBeVisible();

    await client.screenshot('10.2-2fa-persisted.png');
  });

  test('10.3 should clear state when Cancel button is clicked', async () => {
    // Ensure we're on the 2FA form
    const twoFactorVisible = await isTwoFactorFormVisible(client);
    expect(twoFactorVisible).toBe(true);

    // Click the Cancel button
    await client.popup.locator('button:has-text("Cancel")').click();

    // Wait for the form to reset
    await client.popup.waitForTimeout(300);

    // Verify we're back on the login form
    const loginVisible = await isLoginFormVisible(client);
    expect(loginVisible).toBe(true);

    await client.screenshot('10.3-after-cancel.png');

    // Reopen popup and verify state was cleared
    await reopenPopup(client);

    // Should still be on login form (state was cleared)
    const stillOnLogin = await isLoginFormVisible(client);
    expect(stillOnLogin).toBe(true);

    await client.screenshot('10.3-state-cleared.png');
  });

  test('10.4 should complete login with valid 2FA code', async () => {
    // Enter credentials again
    await client.popup.fill('input#username', twoFactorUser.username);
    await client.popup.fill('input#password', twoFactorUser.password);
    await client.popup.click('button:has-text("Log in")');

    // Wait for 2FA form
    await client.popup.waitForSelector('input#twoFactorCode', { state: 'visible', timeout: 15000 });

    // Generate a valid TOTP code
    const totpCode = generateTotpCode(twoFactorUser.totpSecret!);

    // Enter the 2FA code
    await client.popup.fill('input#twoFactorCode', totpCode);

    await client.screenshot('10.4-2fa-code-entered.png');

    // Submit the 2FA code
    await client.popup.click('button:has-text("Verify")');

    // Wait for successful login (vault should be visible)
    await client.popup.getByRole('button', { name: 'Vault' }).waitFor({ state: 'visible', timeout: 15000 });

    await client.screenshot('10.4-login-successful.png');
  });
});
