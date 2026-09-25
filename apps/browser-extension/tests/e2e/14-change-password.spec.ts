/**
 * Category 14: Master Password Change (Requires API)
 *
 * These tests verify the v2 password change flow: an Account Key rewrap that keeps the current
 * session unlocked and does not re-encrypt or push any vault data.
 * They require an API server to be running at localhost:5100.
 */
import { test, expect, TestClient } from '../fixtures';

test.describe.serial('14. Master Password Change', () => {
  let client: TestClient;
  let currentPassword: string;
  const newPassword = `NewPassword${Date.now()}!x`;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('14.1 should login and open the change password screen', async ({ testUser, apiUrl }) => {
    currentPassword = testUser.password;
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);

    await client.goToSettings();
    await client.popup.locator('#security-settings-button').click();
    await client.popup.locator('#change-password-button').click();
    await expect(client.popup.locator('#current-password')).toBeVisible();
    await client.screenshot('14.1-change-password-screen.png');
  });

  test('14.2 should reject a wrong current password locally', async () => {
    await client.popup.fill('#current-password', 'wrong-current-password');
    await client.popup.fill('#new-password', newPassword);
    await client.popup.fill('#confirm-password', newPassword);

    // Check strength indicator is visible
    await expect(client.popup.locator('text=Password Strength')).toBeVisible();

    await client.popup.click('button[type="submit"]');

    // Check wrong password error is visible
    await expect(client.popup.locator('text=Incorrect password')).toBeVisible({ timeout: 15000 });
    await client.screenshot('14.2-wrong-current-password.png');
  });

  test('14.3 should change the password and keep the session unlocked', async () => {
    await client.popup.fill('#current-password', currentPassword);
    await client.popup.fill('#new-password', newPassword);
    await client.popup.fill('#confirm-password', newPassword);
    await client.popup.click('button[type="submit"]');

    await expect(client.popup.locator('text=changed successfully')).toBeVisible({ timeout: 30000 });

    await client.goToVault().then((c) => c.waitForVaultReady());
    await client.screenshot('14.3-password-changed.png');
  });

  test('14.4 should unlock with the new password after locking', async () => {
    await client.lockVault();
    await client.unlockVault(newPassword);
    await client.goToVault().then((c) => c.waitForVaultReady());
    await client.screenshot('14.4-unlocked-with-new-password.png');
  });
});
