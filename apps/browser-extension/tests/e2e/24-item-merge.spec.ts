/**
 * Category 24: Item merge (Requires API + Authentication)
 *
 * Merge an item with one picked on the merge page, opened from the item menu.
 */

import { test, expect, TestClient, Timeouts } from '../fixtures';
import { FieldSelectors } from '../fixtures/selectors';

test.describe('24. Item Merge', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('24.1 should merge an item with its suggested duplicate and keep the chosen password', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    const { popup } = client;


    await test.step('log in and create two items for the same account', async () => {
      await client.login(apiUrl, testUser.username, testUser.password);
      await client.goToVault().then((c) => c.createCredentialWithUrl('Merge GitHub', 'bob', 'Short1!', 'https://github.com'));
      await client.goToVault().then((c) => c.createCredentialWithUrl('github copy', 'bob', 'AnotherPassword2024!', 'https://github.com/login'));
    });

    await test.step('open the merge page from the item menu and pick the suggested duplicate', async () => {
      await client.goToVault();
      await client.itemCard('Merge GitHub').click({ button: 'right' });
      await popup.locator('#item-menu-merge').click();
      await expect(popup).toHaveURL(/\/merge/);
      await popup.locator('#merge-suggestions').locator('li', { hasText: 'github copy' }).locator('button').first().click({ timeout: Timeouts.MEDIUM });
    });

    await test.step('keep the older item and the newer password; the items show their URL', async () => {
      // The older item is suggested; the name and password differ, the username does not.
      await expect(popup.locator('[id="merge-choice-name-target"]')).toContainText('Merge GitHub');
      await expect(popup.locator('[id^="merge-choice-login.username"]')).toHaveCount(0);
      await popup.locator('[id="merge-choice-login.password-source"]').click();
      await expect(popup.locator('label', { hasText: 'github copy' })).toContainText('github.com/login');
      await client.pause();
      await popup.locator('#merge-confirm').click();
    });

    await test.step('the merged item holds both URLs and the chosen password', async () => {
      await expect(popup).toHaveURL(/\/items\/[^/]+\/[^/]+$/, { timeout: Timeouts.MEDIUM });
      await expect(popup.getByText('https://github.com/login')).toBeVisible();
      await client.openEditForm();
      await expect(popup.locator(FieldSelectors.ITEM_NAME)).toHaveValue('Merge GitHub');
      await expect(popup.locator(FieldSelectors.LOGIN_PASSWORD)).toHaveValue('AnotherPassword2024!');
    });

    await test.step('only the kept item is left in the vault', async () => {
      await client.goToVault();
      await expect(client.itemCard('Merge GitHub')).toBeVisible();
      await expect(client.itemCard('github copy')).toHaveCount(0);
    });
  });

  test('24.2 should merge an item with one picked on the merge page, opened from the item menu', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    const { popup } = client;

    const suggestions = popup.locator('#merge-suggestions');

    await test.step('log in and create a login, a 2FA-only copy without URL and an unrelated item', async () => {
      await client.login(apiUrl, testUser.username, testUser.password);
      await client.goToVault().then((c) => c.createCredentialWithUrl('Context Login', 'dave', 'first-password', 'https://example.net'));
      await client.goToVault().then((c) => c.createCredential('Example', 'dave', 'second-password'));
      await client.goToVault().then((c) => c.createCredential('Unrelated thing', 'erin', 'third-password'));
    });

    await test.step('open the merge page from the item menu, back returns to the items', async () => {
      await client.goToVault();
      await client.itemCard('Context Login').click({ button: 'right' });
      await popup.locator('#item-menu-merge').click();
      await expect(popup).toHaveURL(/\/merge/);
      await expect(popup.locator('#merge-base')).toContainText('Context Login');
      await expect(popup.locator('button#back')).toHaveText('Items');
      await popup.locator('button#back').click();
      await expect(popup).toHaveURL(/#\/items$/);
      await client.itemCard('Context Login').click({ button: 'right' });
      await popup.locator('#item-menu-merge').click();
    });

    await test.step('the likely duplicate is suggested, and any item can be searched', async () => {
      await expect(suggestions).toContainText('Example', { timeout: Timeouts.MEDIUM });
      await expect(suggestions).not.toContainText('Unrelated thing');
      await expect(popup.locator('#merge-items')).toHaveCount(0);
      await popup.locator('#merge-search').fill('Unrelated');
      await expect(popup.locator('#merge-items')).toContainText('Unrelated thing');
      await expect(suggestions).toHaveCount(0);
      await popup.locator('#merge-search').fill('');
      await client.pause();
    });

    await test.step('pick the suggestion and merge', async () => {
      await suggestions.locator('li', { hasText: 'Example' }).locator('button').first().click();
      await expect(popup.locator('[id="merge-choice-name-target"]')).toContainText('Context Login');
      await popup.locator('#merge-confirm').click();
      await expect(popup).toHaveURL(/\/items\/[^/]+\/[^/]+$/, { timeout: Timeouts.MEDIUM });
      await expect(popup.getByText('https://example.net')).toBeVisible();
    });

    await test.step('only the kept item is left in the vault', async () => {
      await client.goToVault();
      await expect(client.itemCard('Context Login')).toBeVisible();
      await expect(client.itemCard('Example')).toHaveCount(0);
      await expect(client.itemCard('Unrelated thing')).toBeVisible();
    });

    await test.step('an item without a likely duplicate asks to search, and lists items only once searched', async () => {
      await client.itemCard('Unrelated thing').click({ button: 'right' });
      await popup.locator('#item-menu-merge').click();
      await expect(popup.locator('#merge-search-hint')).toBeVisible({ timeout: Timeouts.MEDIUM });
      await expect(suggestions).toHaveCount(0);
      await expect(popup.locator('#merge-items')).toHaveCount(0);
      await popup.locator('#merge-search').fill('Context');
      await expect(popup.locator('#merge-items')).toContainText('Context Login');
    });
  });
});
