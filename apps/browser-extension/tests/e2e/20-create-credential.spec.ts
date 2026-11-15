/**
 * Category 20: Create Credential (Requires API + Authentication)
 *
 * These tests verify credential creation functionality after login.
 * They require an API server to be running at localhost:5100.
 */
import { test, expect, TestClient } from '../fixtures';
import { ButtonSelectors } from '../fixtures/selectors';

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

  test('20.4 should add, clear and remove website URLs', async () => {
    const { popup } = client;
    const urlRows = popup.locator('input[id^="login.url-"]');
    const removeButtons = urlRows.locator('xpath=following-sibling::button');

    await client.goToVault().then((c) => c.clickCredential(testCredentialName)).then((c) => c.openEditForm());
    await expect(urlRows).toHaveCount(1);
    await expect(removeButtons).toHaveCount(0);

    await test.step('add a second URL; the new row gets the focus', async () => {
      await urlRows.nth(0).fill('https://one.example');
      await popup.locator('[id="add-login.url"]').click();
      await expect(urlRows.nth(1)).toBeFocused();
      await popup.keyboard.type('https://two.example');
      await expect(removeButtons).toHaveCount(2);
    });

    await test.step('a cleared row stays until it is removed', async () => {
      await urlRows.nth(0).fill('');
      await expect(urlRows).toHaveCount(2);
      await removeButtons.nth(0).click();
      await expect(urlRows).toHaveCount(1);
      await expect(urlRows.nth(0)).toHaveValue('https://two.example');
      await expect(removeButtons).toHaveCount(0);
    });

    await test.step('the saved item holds the remaining URL', async () => {
      await popup.locator(ButtonSelectors.SAVE).click();
      await expect(popup.getByText('https://two.example')).toBeVisible();
      await expect(popup.getByText('https://one.example')).toHaveCount(0);
    });
  });
});
