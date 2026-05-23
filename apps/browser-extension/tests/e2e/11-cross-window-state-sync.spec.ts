/**
 * Category 11: Cross-Window State Sync (Requires API)
 *
 * Lock and logout actions performed in one popup must propagate to any other
 * open popup (e.g. the "Open in new window" popout).
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
    await client.popup.reload();
    await client.unlockVault(testUser.password);

    const popout = await context.newPage();
    await popout.goto(`chrome-extension://${extensionId}/popup.html?expanded=true`);
    await waitForVaultReady(popout, Timeouts.LONG);

    // Logout from the main popup: settings → logout → confirm modal.
    await client.popup.reload();
    await client.goToSettings();
    await client.popup.locator('button#logout-button').click();
    await client.popup.locator('button.bg-red-500:has-text("Logout")').click();

    // The popout should observe the access token removal and redirect to /login.
    await waitForLoginForm(popout, Timeouts.MEDIUM);

    await popout.close();
  });
});
