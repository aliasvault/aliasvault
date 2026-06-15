/**
 * Category 11: Cross-Window State Sync (Requires API)
 *
 * Lock, logout, unlock and login actions performed in one popup must propagate
 * to any other open popup (e.g. the "Open in new window" popout).
 */
import {
  test,
  expect,
  TestClient,
  waitForVaultReady,
  waitForUnlockPage,
  waitForLoginForm,
  Timeouts,
} from '../fixtures';

test.describe.serial('11. Cross-Window State Sync', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('11.1 lock in popup propagates to expanded popout', async ({ context, extensionId, apiUrl, testUser }) => {
    client = await TestClient.fromContext(context, extensionId);
    await client.login(apiUrl, testUser.username, testUser.password);

    const popout = await context.newPage();
    await popout.goto(`chrome-extension://${extensionId}/popup.html?expanded=true`);
    await waitForVaultReady(popout, Timeouts.LONG);

    // Opening the popout via context.newPage() focuses it; bring the main
    // popup back to the front before interacting with it.
    await client.popup.bringToFront();
    await client.lockVault();

    // The popout should observe the storage change and redirect to /unlock.
    await waitForUnlockPage(popout, Timeouts.MEDIUM);
    await expect(popout.locator('input#password')).toBeVisible();

    await popout.close();
  });

  test('11.2 logout in popup propagates to expanded popout', async ({ context, extensionId, testUser }) => {
    // Main popup is on /unlock from 11.1; bring it back to the vault.
    await client.popup.bringToFront();
    await client.unlockVault(testUser.password);

    const popout = await context.newPage();
    await popout.goto(`chrome-extension://${extensionId}/popup.html?expanded=true`);
    await waitForVaultReady(popout, Timeouts.LONG);

    // Logout from the main popup: settings → logout → confirm modal.
    await client.popup.bringToFront();
    await client.goToSettings();
    await client.popup.locator('button#logout-button').click();
    await client.popup.locator('button#logout-confirm-button').click();

    // The popout should observe the access token removal and redirect to /login.
    await waitForLoginForm(popout, Timeouts.MEDIUM);

    await popout.close();
  });

  test('11.3 unlock in popup propagates to expanded popout', async ({ context, extensionId, apiUrl, testUser }) => {
    // After 11.2 the popup is on /login; sign back in and lock so both windows start on /unlock.
    await client.popup.bringToFront();
    await client.login(apiUrl, testUser.username, testUser.password);
    await client.lockVault();

    const popout = await context.newPage();
    await popout.goto(`chrome-extension://${extensionId}/popup.html?expanded=true`);
    await waitForUnlockPage(popout, Timeouts.MEDIUM);

    // Unlock from the main popup. The popout should observe the encryption key
    // appearing in session storage and load the now-decrypted vault.
    await client.popup.bringToFront(); 
    await client.unlockVault(testUser.password);

    // Bring popout to the front
    await popout.bringToFront();

    await waitForVaultReady(popout, Timeouts.LONG);

    await popout.close();
  });

  test('11.4 login in popup propagates to expanded popout', async ({ context, extensionId, apiUrl, testUser }) => {
    // Reach a clean logged-out state in the main popup.
    await client.goToSettings();
    await client.popup.locator('button#logout-button').click();
    await client.popup.locator('button#logout-confirm-button').click();
    await waitForLoginForm(client.popup, Timeouts.MEDIUM);

    const popout = await context.newPage();
    await popout.goto(`chrome-extension://${extensionId}/popup.html?expanded=true`);
    await waitForLoginForm(popout, Timeouts.MEDIUM);

    // Log in from the main popup. The popout should observe the access token
    // and encryption key appearing and route itself to the unlocked vault.
    await client.popup.bringToFront();
    await client.login(apiUrl, testUser.username, testUser.password);

    await waitForVaultReady(popout, Timeouts.LONG);

    await popout.close();
  });
});
