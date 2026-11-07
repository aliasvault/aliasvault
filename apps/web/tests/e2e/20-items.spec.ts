/**
 * Category 20: Items (requires API)
 */
import { test, expect } from '../fixtures';

test.describe('20. Items', () => {
  test.beforeEach(async ({ app, testUser }) => {
    await app.login(testUser.username, testUser.password);
  });

  test('20.1 should create an item', async ({ app }) => {
    await app.createItem('Test Service');

    await test.step('the item shows in the vault list', async () => {
      await app.openVault();
      await expect(app.page.getByText('Test Service', { exact: true })).toBeVisible();
    });
  });

  test('20.2 should edit an item', async ({ app }) => {
    const { page } = app;
    await app.createItem('Item service before');

    await test.step('rename the item', async () => {
      await page.getByRole('link', { name: 'Edit item' }).click();
      await expect(page).toHaveURL(/\/edit$/);
      await page.locator('#service-name').fill('Item service after');
      await app.saveItemButton().click();
    });

    await test.step('the view page shows the new name', async () => {
      await expect(page.getByText('Item updated successfully')).toBeVisible();
      await app.expectItemView('Item service after');
      await expect(page.getByText('Item service before')).toHaveCount(0);
    });
  });

  test('20.3 should delete an item', async ({ app }) => {
    const { page } = app;
    await app.createItem('Item to delete');

    await test.step('delete it via the confirmation dialog', async () => {
      await page.getByRole('button', { name: 'Delete item' }).click();
      await page.getByRole('button', { name: 'Yes, I\'m sure' }).click();
    });

    await test.step('the item is gone from the vault list', async () => {
      await expect(page).toHaveURL(/\/items$/);
      await expect(page.getByText('Item successfully deleted.')).toBeVisible();
      await expect(page.getByText('Item to delete', { exact: true })).toHaveCount(0);
    });
  });

  test('20.4 should restore fields after switching the item type back', async ({ app }) => {
    const { page } = app;
    await app.createItem('Type switch service');

    /**
     * Pick another item type on the edit form.
     */
    const switchType = async (type: string): Promise<void> => {
      await page.locator('#itemTypeSelectorToggle').click();
      await page.locator(`#itemTypeSelector_${type}`).click();
    };

    await test.step('make it an alias and fill in the alias fields', async () => {
      await page.getByRole('link', { name: 'Edit item' }).click();
      await expect(page).toHaveURL(/\/edit$/);
      await switchType('Alias');
      await page.locator('#first-name').fill('Jane');
      await page.locator('#last-name').fill('Switcher');
      await page.locator('#username').fill('jswitch');
    });

    await test.step('switching to login drops the alias fields only', async () => {
      await page.pause();
      await switchType('Login');
      await expect(page.locator('#first-name')).toHaveCount(0);
      await expect(page.locator('#username')).toHaveValue('jswitch');
    });

    await test.step('switching to note drops the login fields', async () => {
      await page.pause();
      await switchType('Note');
      await expect(page.locator('#username')).toHaveCount(0);
    });

    await test.step('switching back to alias restores every field', async () => {
      await page.pause();
      await switchType('Alias');
      await page.pause();
      await expect(page.locator('#first-name')).toHaveValue('Jane');
      await expect(page.locator('#last-name')).toHaveValue('Switcher');
      await expect(page.locator('#username')).toHaveValue('jswitch');
    });

    await test.step('the restored fields are saved', async () => {
      await app.saveItemButton().click();
      await expect(page.getByText('Item updated successfully')).toBeVisible();
      await page.getByRole('link', { name: 'Edit item' }).click();
      await expect(page.locator('#first-name')).toHaveValue('Jane');
      await expect(page.locator('#username')).toHaveValue('jswitch');
    });
  });

  test('20.5 should move and delete several items at once', async ({ app }) => {
    const { page } = app;
    const folderName = 'Bulk folder';
    await app.createItem('Bulk one');
    await app.createItem('Bulk two');
    await app.createItem('Bulk keep');

    /**
     * The card of an item in the vault list.
     */
    const card = (name: string): ReturnType<typeof page.locator> => page.locator('.credential-card', { hasText: name });

    await test.step('create a folder', async () => {
      await app.openVault();
      await page.locator('#new-folder-button').click();
      await page.locator('#folder-name').fill(folderName);
      await page.locator('#folder-name').press('Enter');
      await expect(page.getByRole('button', { name: folderName })).toBeVisible();
    });

    await test.step('select two items and move them into the folder', async () => {
      await card('Bulk one').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
      await card('Bulk two').click();
      await expect(page.locator('#selection-action-bar')).toContainText('2 selected');
      await page.locator('#selection-move').click();
      await page.getByRole('button', { name: folderName }).last().click();
      await expect(page.getByText('Moved 2 items')).toBeVisible();
      await expect(page.locator('#selection-action-bar')).toHaveCount(0);
      await expect(card('Bulk one')).toHaveCount(0);
      await expect(card('Bulk keep')).toBeVisible();
    });

    await test.step('the folder holds both items', async () => {
      await app.openFolder(folderName);
      await expect(card('Bulk one')).toBeVisible();
      await expect(card('Bulk two')).toBeVisible();
    });

    await test.step('select all in the folder and delete', async () => {
      await card('Bulk one').click({ modifiers: ['ControlOrMeta'] });
      await page.locator('#selection-action-bar').getByRole('button', { name: 'Select all' }).click();
      await expect(page.locator('#selection-action-bar')).toContainText('2 selected');
      await page.locator('#selection-delete').click();
      await expect(page.getByRole('heading', { name: 'Delete 2 items?' })).toBeVisible();
      await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
      await expect(page.getByText('Deleted 2 items')).toBeVisible();
      await expect(card('Bulk one')).toHaveCount(0);
      await expect(card('Bulk two')).toHaveCount(0);
    });
  });
});
