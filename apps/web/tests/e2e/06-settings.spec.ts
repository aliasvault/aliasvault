/**
 * Category 6: Settings (requires API)
 */
import { test, expect } from '../fixtures';

import type { Locator } from '@playwright/test';

test.describe('6. Settings', () => {
  test('6.1 should keep the app language in the vault', async ({ app, testUser }) => {
    const { page } = app;
    /**
     * The Emails link of the top menu, by its translated name.
     */
    const emailsLink = (name: string): Locator => page.getByRole('link', { name, exact: true }).first();
    await app.login(testUser.username, testUser.password);

    await test.step('switch to Dutch', async () => {
      await page.locator('#toggleMobileMenuButton').click();
      await page.locator('#mobileMenuDropdown').getByRole('link', { name: 'General settings' }).click();
      await page.locator('#appLanguage').selectOption('nl');
      await expect(emailsLink('E-mails')).toBeVisible();
    });

    await test.step('a reload keeps Dutch', async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/unlock$/);
      await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible();
      await page.locator('#password').fill(testUser.password);
      await page.getByRole('button', { name: 'Ontgrendelen' }).click();
      await expect(page).toHaveURL(/\/settings\/general$/);
      await expect(emailsLink('E-mails')).toBeVisible();
    });

    await test.step('a browser without local preferences takes the language from the vault', async () => {
      await page.goto('/user/logout');
      await expect(page).toHaveURL(/\/user\/login$/);
      await page.evaluate(() => localStorage.clear());
      await app.login(testUser.username, testUser.password);
      await expect(emailsLink('E-mails')).toBeVisible();
    });
  });
});
