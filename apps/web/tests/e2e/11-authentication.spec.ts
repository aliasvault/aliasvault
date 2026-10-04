/**
 * Category 11: Authentication (requires API)
 */
import { test, expect } from '../fixtures';

test.describe('11. Authentication', () => {
  test('11.1 should log in and log out', async ({ app, testUser }) => {
    await test.step('log in', async () => {
      await app.login(testUser.username, testUser.password);
      await expect(app.page.getByText('No items yet')).toBeVisible();
    });

    await test.step('log out', async () => {
      await app.logout();
    });

    await test.step('logged out visitors are sent to the start page', async () => {
      await app.page.goto('/items');
      await expect(app.page).toHaveURL(/\/user\/start$/);
    });
  });

  test('11.2 should reject invalid credentials', async ({ app, credentials }) => {
    await app.page.goto('/user/login');
    await app.page.locator('#email').fill(credentials.username);
    await app.page.locator('#password').fill(credentials.password);
    await app.page.locator('#login-button').click();

    await expect(app.page.getByText('Invalid username or password')).toBeVisible();
    await expect(app.page).toHaveURL(/\/user\/login$/);
  });

  test('11.3 should return to the open page after unlocking a reloaded vault', async ({ app, testUser }) => {
    const { page } = app;
    await app.login(testUser.username, testUser.password);
    await app.createItem('Return after unlock');
    const itemUrl = page.url();

    await test.step('reloading locks the vault', async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/unlock$/);
    });

    await test.step('unlocking returns to the item', async () => {
      await page.locator('#password').fill(testUser.password);
      await page.locator('#unlock-button').click();
      await expect(page).toHaveURL(itemUrl);
      await app.expectItemView('Return after unlock');
    });
  });
});
