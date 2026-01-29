/**
 * Category 7: Offline Sync (Requires API + Multi-Client Scenario)
 *
 * These tests verify offline mode functionality and subsequent sync behavior:
 *
 * Scenario:
 * 1. Client A (online) and Client B (will go offline) both login to the same account
 * 2. Client A creates a credential while online and syncs
 * 3. Client B goes offline (by changing API URL to invalid)
 * 4. Client B creates a new credential while offline (stored locally with hasPendingSync=true)
 * 5. Client B locks the vault locally
 * 6. Client B unlocks the vault (still offline - uses stored encryption params)
 * 7. Client B goes back online (restore valid API URL)
 * 8. Client B navigates to root to trigger sync (should merge local changes with server)
 * 9. Client A syncs and verifies both credentials are present
 */
import { test, expect, TestClient, FieldSelectors, ButtonSelectors } from '../fixtures';

test.describe.serial('7. Offline Sync', () => {
  let clientA: TestClient;
  let clientB: TestClient;
  let originalApiUrl: string;
  let sharedTestUser: { username: string; password: string };

  const credentialNameA = `Online Client A ${Date.now()}`;
  const credentialNameB = `Offline Client B ${Date.now() + 1}`;

  test.afterAll(async () => {
    await TestClient.cleanupAll(clientA, clientB);
  });

  test('7.1 Setup: Both clients login to the same account', async ({ testUser, apiUrl }) => {
    sharedTestUser = { username: testUser.username, password: testUser.password };
    originalApiUrl = apiUrl;

    clientA = await TestClient.create();
    await clientA.login(apiUrl, testUser.username, testUser.password);

    clientB = await TestClient.create();
    await clientB.login(apiUrl, testUser.username, testUser.password);

    await clientA.screenshot('7.1-client-a-logged-in.png');
    await clientB.screenshot('7.1-client-b-logged-in.png');
  });

  test('7.2 Client A creates a credential while online', async () => {
    await clientA
      .goToVault()
      .then((c) => c.createCredential(credentialNameA, 'clientA@example.com', 'ClientAPassword123!'))
      .then((c) => c.goToVault())
      .then((c) => c.verifyCredentialExists(credentialNameA))
      .then((c) => c.screenshot('7.2-client-a-credential-created.png'));
  });

  test('7.3 Client B goes offline', async () => {
    await clientB
      .enableOfflineMode()
      .then((c) => c.triggerSync())
      .then((c) => c.waitForOffline())
      .then((c) => c.screenshot('7.3-client-b-offline-mode.png'));
  });

  test('7.4 Client B creates a credential while offline', async () => {
    await clientB.goToVault();
    await clientB.popup.locator(ButtonSelectors.ADD_NEW_ITEM).click();
    // All fields are now visible on the same page (no "Next" step)
    await expect(clientB.popup.locator(FieldSelectors.LOGIN_USERNAME)).toBeVisible({ timeout: 10000 });
    await clientB.popup.fill(FieldSelectors.ITEM_NAME, credentialNameB);
    await clientB.popup.fill(FieldSelectors.LOGIN_USERNAME, 'clientB@example.com');
    await clientB.popup.fill(FieldSelectors.LOGIN_PASSWORD, 'ClientBPassword456!');
    await clientB.popup.click(ButtonSelectors.SAVE);

    await clientB
      .verifyCredentialExists(credentialNameB)
      .then((c) => c.screenshot('7.4-client-b-offline-credential-saved.png'));

    await clientB
      .goToVault()
      .then((c) => c.verifyCredentialExists(credentialNameB))
      .then((c) => c.screenshot('7.4-client-b-offline-credential-in-list.png'));
  });

  test('7.5 Client B locks vault while offline', async () => {
    await clientB
      .lockVault()
      .then((c) => c.screenshot('7.5-client-b-vault-locked.png'));
  });

  test('7.6 Client B unlocks vault while still offline', async () => {
    await clientB
      .unlockVault(sharedTestUser.password)
      .then((c) => c.screenshot('7.6-client-b-after-unlock.png'))
      .then((c) => c.goToVault())
      .then((c) => c.verifyCredentialExists(credentialNameB))
      .then((c) => c.screenshot('7.6-client-b-offline-vault-unlocked.png'));
  });

  test('7.7 Client B goes back online and triggers sync', async () => {
    await clientB
      .disableOfflineMode(originalApiUrl)
      .then((c) => c.triggerSync())
      .then((c) => c.screenshot('7.7-client-b-back-online.png'))
      .then((c) => c.goToVault())
      .then((c) => c.verifyCredentialExists(credentialNameB))
      .then((c) => c.verifyCredentialExists(credentialNameA))
      .then((c) => c.screenshot('7.7-client-b-vault-after-sync.png'))
      .then((c) => c.verifyVaultItemCount(2));
  });

  test('7.8 Client A syncs and verifies both credentials are present', async () => {
    await clientA
      .triggerSync()
      .then((c) => c.goToVault())
      .then((c) => c.verifyCredentialExists(credentialNameA))
      .then((c) => c.verifyCredentialExists(credentialNameB))
      .then((c) => c.screenshot('7.8-client-a-vault-after-sync.png'))
      .then((c) => c.verifyVaultItemCount(2))
      .then((c) => c.screenshot('7.8-client-a-both-credentials.png'));
  });
});
