/**
 * Category 3: Items (requires API)
 */
import { test, expect } from '../fixtures';

test.describe('3. Items', () => {
  test.beforeEach(async ({ app, testUser }) => {
    await app.login(testUser.username, testUser.password);
  });

  test('3.1 should create an item', async ({ app }) => {
    await app.createItem('Test Service');

    await test.step('the item shows in the vault list', async () => {
      await app.openVault();
      await expect(app.page.getByText('Test Service', { exact: true })).toBeVisible();
    });
  });

  test('3.2 should edit an item', async ({ app }) => {
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

  test('3.3 should delete an item', async ({ app }) => {
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
});
