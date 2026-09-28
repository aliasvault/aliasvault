/**
 * Category 1: Full registration setup flow via web app UI (requires API)
 */
import { test, expect } from '../fixtures';

test.describe('1. Registration', () => {
  test('1.1 should create a new account through the setup wizard', async ({ app, credentials }) => {
    const { page } = app;
    const continueButton = page.getByRole('button', { name: 'Continue' });

    await test.step('open the setup wizard', async () => {
      await app.openStart();
      await page.getByRole('link', { name: 'Create new vault' }).click();
      await expect(page).toHaveURL(/\/user\/setup$/);
    });

    await test.step('accept the terms', async () => {
      await page.locator('#agreeTerms').check();
      await continueButton.click();
    });

    await test.step('choose a username, checked against the server', async () => {
      await page.locator('#username').fill(credentials.username);
      await expect(page.getByText('Username is available')).toBeVisible();
      await continueButton.click();
    });

    await test.step('set the master password and create the account', async () => {
      await page.locator('#password').fill(credentials.password);
      await page.locator('#confirmPassword').fill(credentials.password);
      await page.getByRole('button', { name: 'Create Account' }).click();
    });

    await test.step('the welcome tutorial confirms the new vault', async () => {
      await expect(page).toHaveURL(/\/welcome$/);
      await expect(page.getByText('Your vault has been successfully created!')).toBeVisible();
      await app.finishTutorial();
      await app.expectVaultOpen(credentials.username);
    });

    // A new vault starts out empty.
    await expect(page.getByText('No items yet')).toBeVisible();
  });
});
