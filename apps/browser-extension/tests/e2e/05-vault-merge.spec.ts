/**
 * Category 5: Vault Merge (Requires API + Multi-Client Scenario)
 *
 * These tests verify the vault merge logic when two clients make concurrent changes.
 *
 * Scenario:
 * 1. Client A and Client B both login to the same account (both have empty vault)
 * 2. Client A creates credential 1 and uploads it
 * 3. Client B (still has stale local vault) creates credential 2 and tries to upload
 * 4. Client B triggers a vault merge (merges latest vault from A with its local mutations)
 * 5. After merge, Client B's vault should contain both credentials
 * 6. Client A syncs and should also see both credentials
 */
import { test, expect, TestClient, FieldSelectors, ButtonSelectors } from '../fixtures';

test.describe.serial('5. Vault Merge', () => {
  let clientA: TestClient;
  let clientB: TestClient;

  const credentialNameA = `Client A Credential ${Date.now()}`;
  const credentialNameB = `Client B Credential ${Date.now() + 1}`;

  test.afterAll(async () => {
    await TestClient.cleanupAll(clientA, clientB);
  });

  test('5.1 should setup two clients and navigate both to add credential form', async ({ testUser, apiUrl }) => {
    clientA = await TestClient.create();
    await clientA.login(apiUrl, testUser.username, testUser.password);

    clientB = await TestClient.create();
    await clientB.login(apiUrl, testUser.username, testUser.password);

    // Navigate BOTH clients to the add credential form NOW, before either makes changes.
    // This ensures both have the same vault revision (empty vault, revision 1).
    await clientA.goToVault().then((c) => c.openAddCredentialForm());
    await clientB.goToVault().then((c) => c.openAddCredentialForm());

    await clientA.screenshot('5.1-client-a-add-form.png');
    await clientB.screenshot('5.1-client-b-add-form.png');
  });

  test('5.2 Client A should create a credential and sync', async () => {
    // Client A fills and saves the credential (both clients have revision 1 at this point)
    // All fields are now visible on the same page (no "Next" step)
    await expect(clientA.popup.locator(FieldSelectors.LOGIN_USERNAME)).toBeVisible({ timeout: 10000 });
    await clientA.popup.fill(FieldSelectors.ITEM_NAME, credentialNameA);
    await clientA.popup.fill(FieldSelectors.LOGIN_USERNAME, 'clientA@example.com');
    await clientA.popup.fill(FieldSelectors.LOGIN_PASSWORD, 'ClientAPassword123!');
    await clientA.popup.click(ButtonSelectors.SAVE);

    await clientA
      .verifyCredentialExists(credentialNameA)
      .then((c) => c.screenshot('5.2-client-a-credential-saved.png'))
      .then((c) => c.goToVault())
      .then((c) => c.verifyCredentialExists(credentialNameA))
      .then((c) => c.screenshot('5.2-client-a-vault.png'));
  });

  test('5.3 Client B should create a credential (triggers merge with Client A changes)', async () => {
    // Client B still has stale data (revision 1, empty vault)
    // This should trigger a merge because the server has revision 2 from Client A
    // All fields are now visible on the same page (no "Next" step)
    await expect(clientB.popup.locator(FieldSelectors.LOGIN_USERNAME)).toBeVisible({ timeout: 10000 });
    await clientB.popup.fill(FieldSelectors.ITEM_NAME, credentialNameB);
    await clientB.popup.fill(FieldSelectors.LOGIN_USERNAME, 'clientB@example.com');
    await clientB.popup.fill(FieldSelectors.LOGIN_PASSWORD, 'ClientBPassword456!');
    await clientB.popup.click(ButtonSelectors.SAVE);

    await clientB
      .verifyCredentialExists(credentialNameB)
      .then((c) => c.screenshot('5.3-client-b-after-save.png'));
  });

  test('5.4 Client B vault should contain both credentials after merge', async () => {
    // Trigger sync to ensure background merge has completed and database is reloaded
    await clientB
      .triggerSync()
      .then((c) => c.goToVault())
      .then((c) => c.screenshot('5.4-client-b-vault-state.png'))
      .then((c) => c.verifyCredentialExists(credentialNameA));

    const clientBCredential = clientB.popup.locator(`text=${credentialNameB}`);
    const hasBothCredentials = await clientBCredential.isVisible().catch(() => false);

    if (hasBothCredentials) {
      await clientB.verifyVaultItemCount(2);
    } else {
      throw new Error('Merge logic failed');
    }
  });

  test('5.5 Client A should see credentials after syncing', async () => {
    await clientA
      .triggerSync()
      .then((c) => c.verifyCredentialExists(credentialNameA))
      .then((c) => c.screenshot('5.5-client-a-vault-state.png'));

    await clientA.verifyVaultItemCount(2);
  });
});
