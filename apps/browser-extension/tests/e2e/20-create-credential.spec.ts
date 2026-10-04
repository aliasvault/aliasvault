/**
 * Category 20: Create Credential (Requires API + Authentication)
 *
 * These tests verify credential creation functionality after login.
 * They require an API server to be running at localhost:5100.
 */
import { test, expect, TestClient } from '../fixtures';

test.describe.serial('20. Create Credential', () => {
  let client: TestClient;
  const testCredentialName = `Test Login ${Date.now()}`;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('20.1 should login and show vault content', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);

    const rootContent = await client.popup.locator('#root').textContent();
    expect(rootContent).toBeTruthy();
    expect(rootContent!.length).toBeGreaterThan(0);

    await client.screenshot('20.1-vault-content.png');
  });

  test('20.2 should create a new credential', async () => {
    await client
      .goToVault()
      .then((c) => c.createCredential(testCredentialName, 'testuser@example.com', 'TestPassword123!'))
      .then((c) => c.screenshot('20.2-credential-saved.png'));
  });

  test('20.3 should show the created credential in the vault list', async () => {
    await client
      .goToVault()
      .then((c) => c.waitForVaultReady())
      .then((c) => c.verifyCredentialExists(testCredentialName))
      .then((c) => c.screenshot('20.3-credential-in-list.png'));
  });
});
