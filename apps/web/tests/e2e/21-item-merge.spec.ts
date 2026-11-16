/**
 * Category 21: Item merge (requires API)
 *
 * Merge two selected items into one, and merge an item with one picked in the merge dialog.
 */
import { test, expect } from '../fixtures';
import { ITEM_VIEW_URL } from '../fixtures/WebApp';

test.describe('21. Item merge', () => {
  test.beforeEach(async ({ app, testUser }) => {
    await app.login(testUser.username, testUser.password);
  });

  test('21.1 should merge two selected items and keep the chosen password', async ({ app }) => {
    const { page } = app;

    /**
     * The card of an item in the vault list.
     */
    const card = (name: string): ReturnType<typeof page.locator> => page.locator('.credential-card', { hasText: name });

    await test.step('create two items for the same account', async () => {
      await app.createLogin('Merge GitHub', { url: 'https://github.com', username: 'bob', password: 'Short1!' });
      await app.createLogin('github copy', { url: 'https://github.com/login', username: 'bob', password: 'AnotherPassword2024!' });
    });

    await test.step('select both items and open the merge dialog', async () => {
      await app.openVault();
      await card('Merge GitHub').click({ modifiers: ['ControlOrMeta'] });
      await expect(page.locator('#selection-merge')).toBeDisabled();
      await card('github copy').click({ modifiers: ['ControlOrMeta'] });
      await page.locator('#selection-merge').click();
      await expect(page.getByRole('heading', { name: 'Merge items' })).toBeVisible();
    });

    await test.step('keep the older item and the newer password; the items show their URL', async () => {
      // The older item is suggested; the name and password differ, the username does not.
      await expect(page.locator('[id="merge-choice-name-target"]')).toContainText('Merge GitHub');
      await expect(page.locator('[id^="merge-choice-login.username"]')).toHaveCount(0);
      await page.locator('[id="merge-choice-login.password-source"]').click();
      await expect(page.locator('label', { hasText: 'github copy' })).toContainText('github.com/login');
      await app.pause();
      await page.locator('#merge-confirm').click();
    });

    await test.step('the merged item holds both URLs and the chosen password', async () => {
      await app.expectItemView('Merge GitHub');
      await expect(page.getByText('Items merged successfully')).toBeVisible();
      await expect(page.getByText('https://github.com/login')).toBeVisible();
      await page.getByRole('link', { name: 'Edit item' }).click();
      await expect(page.locator('#service-name')).toHaveValue('Merge GitHub');
      await expect(page.locator('#password')).toHaveValue('AnotherPassword2024!');
    });

    await test.step('only the kept item is left in the vault', async () => {
      await app.openVault();
      await expect(card('Merge GitHub')).toBeVisible();
      await expect(card('github copy')).toHaveCount(0);
    });
  });

  test('21.2 should merge an item with one picked in the merge dialog, opened from the item menu', async ({ app }) => {
    const { page } = app;
    const suggestions = page.locator('#merge-suggestions');

    /**
     * The card of an item in the vault list.
     */
    const card = (name: string): ReturnType<typeof page.locator> => page.locator('.credential-card', { hasText: name });

    await test.step('create a login, a copy without URL and an unrelated item', async () => {
      await app.createLogin('Context Login', { url: 'https://example.net', username: 'dave', password: 'first-password' });
      await app.createLogin('Example', { username: 'dave', password: 'second-password' });
      await app.createLogin('Unrelated thing', { username: 'erin', password: 'third-password' });
    });

    await test.step('open the merge dialog from the item menu', async () => {
      await app.openVault();
      await card('Context Login').click({ button: 'right' });
      await page.locator('#item-menu-merge').click();
      await expect(page.getByRole('heading', { name: 'Merge items' })).toBeVisible();
      await expect(page.locator('#merge-base')).toContainText('Context Login');
    });

    await test.step('a click outside closes the dialog while picking', async () => {
      await page.mouse.click(5, 5);
      await expect(page.getByRole('heading', { name: 'Merge items' })).toHaveCount(0);
      await card('Context Login').click({ button: 'right' });
      await page.locator('#item-menu-merge').click();
    });

    await test.step('the likely duplicate is suggested, and any item can be searched', async () => {
      await expect(suggestions).toContainText('Example');
      await expect(suggestions).not.toContainText('Unrelated thing');
      await expect(page.locator('#merge-items')).toHaveCount(0);
      await page.locator('#merge-search').fill('Unrelated');
      await expect(page.locator('#merge-items')).toContainText('Unrelated thing');
      await expect(suggestions).toHaveCount(0);
      await page.locator('#merge-search').fill('');
      await app.pause();
    });

    await test.step('pick the suggestion and merge', async () => {
      await suggestions.locator('li', { hasText: 'Example' }).locator('button').first().click();
      await expect(page.locator('[id="merge-choice-name-target"]')).toContainText('Context Login');
      // Past the picker a click outside no longer closes the dialog.
      await page.mouse.click(5, 5);
      await expect(page.locator('#merge-confirm')).toBeVisible();
      await page.locator('#merge-confirm').click();
      await expect(page).toHaveURL(ITEM_VIEW_URL);
      await expect(page.getByText('https://example.net')).toBeVisible();
    });

    await test.step('only the kept item is left in the vault', async () => {
      await app.openVault();
      await expect(card('Context Login')).toBeVisible();
      await expect(card('Example')).toHaveCount(0);
      await expect(card('Unrelated thing')).toBeVisible();
    });

    await test.step('an item without a likely duplicate asks to search, and lists items only once searched', async () => {
      await card('Unrelated thing').click({ button: 'right' });
      await page.locator('#item-menu-merge').click();
      await expect(page.locator('#merge-search-hint')).toBeVisible();
      await expect(suggestions).toHaveCount(0);
      await expect(page.locator('#merge-items')).toHaveCount(0);
      await page.locator('#merge-search').fill('Context');
      await expect(page.locator('#merge-items')).toContainText('Context Login');
    });
  });
});
