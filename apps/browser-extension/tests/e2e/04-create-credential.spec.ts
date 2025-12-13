/**
 * Category 4: Create Credential (Requires API + Authentication)
 *
 * These tests verify credential creation functionality after login.
 * They require an API server to be running at localhost:5092.
 */
import { test, expect, TestClient } from '../fixtures';

test.describe.serial('4. Create Credential', () => {
  let client: TestClient;
  const testCredentialName = `Test Login ${Date.now()}`;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('4.1 should login and show vault content', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);

    const rootContent = await client.popup.locator('#root').textContent();
    expect(rootContent).toBeTruthy();
    expect(rootContent!.length).toBeGreaterThan(0);

    await client.screenshot('4.1-vault-content.png');
  });

  test('4.2 should create a new credential', async () => {
    await client
      .goToVault()
      .then((c) => c.createCredential(testCredentialName, 'testuser@example.com', 'TestPassword123!'))
      .then((c) => c.screenshot('4.2-credential-saved.png'));
  });

  test('4.3 should show the created credential in the vault list', async () => {
    await client
      .goToVault()
      .then((c) => c.waitForVaultReady())
      .then((c) => c.verifyCredentialExists(testCredentialName))
      .then((c) => c.screenshot('4.3-credential-in-list.png'));
  });
});
