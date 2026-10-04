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
});
