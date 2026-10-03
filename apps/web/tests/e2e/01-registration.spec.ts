/**
 * Category 1: Full registration setup flow via web app UI (requires API)
 */
import { test, expect } from '../fixtures';
import { createRegistrationInvite, TEST_DISABLE_PUBLIC_REGISTRATION_HEADER } from '../helpers/test-api';

test.describe('1. Registration', () => {
  test('1.1 should create a new account through the setup wizard', async ({ app, credentials }) => {
    const { page } = app;
    const continueButton = page.getByRole('button', { name: 'Continue' });

    await test.step('open the setup wizard', async () => {
      await app.openStart();
      await page.getByRole('link', { name: 'Create new vault' }).click();
      await expect(page).toHaveURL(/\/user\/setup$/);
    });

    await test.step('choose a username, checked against the server', async () => {
      await page.locator('#username').fill(credentials.username);
      await expect(page.getByText('Username is available')).toBeVisible();
      await continueButton.click();
    });

    await test.step('set the master password and create the account', async () => {
      await page.locator('#password').fill(credentials.password);
      await page.locator('#confirmPassword').fill(credentials.password);
      await page.locator('#agreeTerms').check();
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

test.describe('1. Registration with public registration disabled', () => {
  test.use({ publicRegistrationEnabled: false });

  test('1.2 should refuse registration without an invite link', async ({ app, apiUrl, credentials }) => {
    const { page } = app;

    await test.step('the start page offers no way to create a vault', async () => {
      await app.openStart();
      await expect(page.getByRole('link', { name: 'Log in with existing account' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Create new vault' })).toHaveCount(0);
    });

    await test.step('the setup wizard explains registration is disabled without an invite link', async () => {
      await page.goto('/user/setup');
      await expect(page.getByText('User registration is disabled')).toBeVisible();
      await expect(page.getByText('Ask the server administrator for an invite.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
    });

    await test.step('the API refuses a username check without an invite and accepts one with a valid invite', async () => {
      /**
       * Check the test username as a client of the closed server would.
       */
      const validateUsername = (inviteCode?: string): Promise<Response> => fetch(`${apiUrl}/v2/Auth/validate-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [TEST_DISABLE_PUBLIC_REGISTRATION_HEADER]: 'true' },
        body: JSON.stringify({ username: credentials.username, inviteCode }),
      });
      expect((await validateUsername()).status).toBe(400);
      expect((await validateUsername('AAAA-AAAA-AAAA-AAAA-AAAA')).status).toBe(400);
      expect((await validateUsername(await createRegistrationInvite(apiUrl))).status).toBe(200);
    });
  });

  test('1.3 should create an account through an invite link and use up the invite', async ({ app, apiUrl, credentials }) => {
    const { page } = app;
    const continueButton = page.getByRole('button', { name: 'Continue' });
    const inviteCode = await createRegistrationInvite(apiUrl);

    await test.step('open the invite link', async () => {
      await page.goto(`/user/setup?invite=${encodeURIComponent(inviteCode)}`);
    });

    await test.step('choose a username, checked against the server with the invite', async () => {
      await page.locator('#username').fill(credentials.username);
      await expect(page.getByText('Username is available')).toBeVisible();
      await continueButton.click();
    });

    await test.step('set the master password and create the account', async () => {
      await page.locator('#password').fill(credentials.password);
      await page.locator('#confirmPassword').fill(credentials.password);
      await page.locator('#agreeTerms').check();
      await page.getByRole('button', { name: 'Create Account' }).click();
      await expect(page).toHaveURL(/\/welcome$/);
    });

    await test.step('the single-use invite is now used up', async () => {
      const response = await fetch(`${apiUrl}/v2/Auth/validate-invite-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
      });
      expect(response.status).toBe(400);
    });
  });

  test('1.4 should reject an unknown invite link', async ({ app }) => {
    const { page } = app;

    await page.goto('/user/setup?invite=AAAA-AAAA-AAAA-AAAA-AAAA');
    await expect(page.getByText('This invite link is invalid, has expired or has already been used.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  });
});
