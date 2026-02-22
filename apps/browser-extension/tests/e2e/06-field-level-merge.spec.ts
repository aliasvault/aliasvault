/**
 * Category 6: Field-Level Merge (Requires API + Multi-Client Scenario)
 *
 * These tests verify that when the same credential is modified on two clients
 * simultaneously, the merge happens at the field level:
 * - Fields modified only on Client A are preserved
 * - Fields modified only on Client B are preserved
 * - Fields modified on both clients: the last writer wins
 *
 * Scenario:
 * 1. Client A and Client B both login to the same account
 * 2. Client A creates a credential and both clients sync
 * 3. Client A edits the credential: changes username and notes
 * 4. Client B (with stale data) edits the same credential: changes password and notes
 * 5. After merge, both username (from A) and password (from B) should be preserved
 * 6. Notes should have Client B's value (last writer wins)
 */
import { test, expect, TestClient, FieldSelectors } from '../fixtures';

test.describe.serial('6. Field-Level Merge', () => {
  let clientA: TestClient;
  let clientB: TestClient;

  const credentialName = `Field Merge Test ${Date.now()}`;
  const originalUsername = 'original@example.com';
  const originalPassword = 'OriginalPassword123!';

  const clientAUsername = 'clientA_modified_user@example.com';
  const clientANotes = 'Notes modified by Client A';
  const clientBPassword = 'ClientBModifiedPassword789!';
  const clientBNotes = 'Notes modified by Client B - this should win';

  test.afterAll(async () => {
    await TestClient.cleanupAll(clientA, clientB);
  });

  test('6.1 Setup: Both clients login and Client A creates a credential', async ({ testUser, apiUrl }) => {
    clientA = await TestClient.create();
    await clientA.login(apiUrl, testUser.username, testUser.password);

    clientB = await TestClient.create();
    await clientB.login(apiUrl, testUser.username, testUser.password);

    await clientA
      .goToVault()
      .then((c) => c.createCredential(credentialName, originalUsername, originalPassword))
      .then((c) => c.screenshot('6.1-client-a-credential-created.png'));
  });

  test('6.2 Both clients sync and verify credential exists', async () => {
    await clientA
      .goToVault()
      .then((c) => c.screenshot('6.2-client-a-vault.png'))
      .then((c) => c.verifyCredentialExists(credentialName));

    await clientB
      .triggerSync()
      .then((c) => c.verifyCredentialExists(credentialName));
  });

  test('6.3 Client A edits credential (username and notes) and saves', async () => {
    await clientA
      .clickCredential(credentialName)
      .then((c) => c.openEditForm())
      .then((c) => c.fillUsername(clientAUsername))
      .then((c) => c.fillNotes(clientANotes))
      .then((c) => c.screenshot('6.3-client-a-before-save.png'))
      .then((c) => c.saveCredential())
      .then((c) => c.screenshot('6.3-client-a-after-save.png'))
      // Ensure changes are synced to server before Client B edits
      .then((c) => c.triggerSync());
  });

  test('6.4 Client B edits same credential (password and notes) with stale data', async () => {
    await clientB
      .clickCredential(credentialName)
      .then((c) => c.screenshot('6.4-client-b-stale-details.png'))
      .then((c) => c.openEditForm())
      .then((c) => c.screenshot('6.4-client-b-stale-form.png'))
      .then((c) => c.fillPassword(clientBPassword))
      .then((c) => c.fillNotes(clientBNotes))
      .then((c) => c.screenshot('6.4-client-b-before-save.png'))
      .then((c) => c.saveCredential())
      .then((c) => c.screenshot('6.4-client-b-after-save.png'));

    // Wait for the save operation to be persisted before moving to next test
    await clientB.popup.waitForTimeout(1000);
  });

  test('6.5 Client B verifies field-level merge result', async () => {
    // Trigger sync to get the merged result from server
    // The save in 6.4 triggered background sync+merge on server
    await clientB.triggerSync();

    // Navigate to vault to ensure we're in a stable state
    await clientB.goToVault();

    // Click credential and open edit form
    await clientB
      .clickCredential(credentialName)
      .then((c) => c.openEditForm())
      .then((c) => c.screenshot('6.5-client-b-merged-form.png'));

    // Wait for merged values to appear (polling until sync completes)
    await clientB
      .waitForFieldValue(FieldSelectors.LOGIN_USERNAME, clientAUsername)
      .then((c) => c.waitForFieldValue(FieldSelectors.LOGIN_PASSWORD, clientBPassword))
      .then((c) => c.waitForFieldValue(FieldSelectors.LOGIN_NOTES, clientBNotes));

    // Verify the values are correct
    const usernameValue = await clientB.getFieldValue(FieldSelectors.LOGIN_USERNAME);
    expect(usernameValue).toBe(clientAUsername);

    const passwordValue = await clientB.getFieldValue(FieldSelectors.LOGIN_PASSWORD);
    expect(passwordValue).toBe(clientBPassword);

    const notesValue = await clientB.getFieldValue(FieldSelectors.LOGIN_NOTES);
    expect(notesValue).toBe(clientBNotes);

    await clientB.popup.goBack();
    await clientB.verifyCredentialExists(credentialName);
  });

  test('6.6 Client A syncs and verifies merged credential', async () => {
    // Trigger sync to get the merged result from server
    await clientA.triggerSync();

    // Navigate to vault to ensure we're in a stable state
    await clientA.goToVault();

    // Click credential and open edit form
    await clientA
      .clickCredential(credentialName)
      .then((c) => c.openEditForm())
      .then((c) => c.screenshot('6.6-client-a-synced-form.png'));

    // Wait for merged values to appear (polling until sync completes)
    await clientA
      .waitForFieldValue(FieldSelectors.LOGIN_USERNAME, clientAUsername)
      .then((c) => c.waitForFieldValue(FieldSelectors.LOGIN_PASSWORD, clientBPassword))
      .then((c) => c.waitForFieldValue(FieldSelectors.LOGIN_NOTES, clientBNotes));

    // Verify the values are correct
    const usernameValue = await clientA.getFieldValue(FieldSelectors.LOGIN_USERNAME);
    expect(usernameValue).toBe(clientAUsername);

    const passwordValue = await clientA.getFieldValue(FieldSelectors.LOGIN_PASSWORD);
    expect(passwordValue).toBe(clientBPassword);

    const notesValue = await clientA.getFieldValue(FieldSelectors.LOGIN_NOTES);
    expect(notesValue).toBe(clientBNotes);
  });
});
