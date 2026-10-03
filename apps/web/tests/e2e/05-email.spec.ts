/**
 * Category 5: Email (requires API and SMTP service, e.g. `./scripts/dev.sh smtp`)
 */
import { test, expect } from '../fixtures';
import { requireSmtp, sendMail } from '../helpers/smtp';

test.describe('5. Email', () => {
  test.beforeAll(requireSmtp);

  test('5.1 should receive and decrypt mail on an alias of a new account', async ({ app, testUser }) => {
    const { page } = app;
    const id = Math.random().toString(36).substring(2, 10);
    const address = `e2e_${id}@example.tld`;
    // Short, as the item page truncates long subjects.
    const subject = `Mail ${id}`;

    await app.login(testUser.username, testUser.password);

    await test.step('create a login item with an address on a private domain', async () => {
      await page.locator('#topBarQuickCreateButton').click();
      await page.locator('#serviceName').fill('Mail test');
      await page.locator('#quickIdentitySubmit').click();
      await page.getByRole('button', { name: 'Email', exact: true }).click();
      await page.locator('#email').fill(address);
      await app.saveItemButton().click();
      await expect(page.getByText('Item created successfully')).toBeVisible();
      await app.expectItemView('Mail test');
    });

    await test.step('the SMTP service accepts mail for the address', async () => {
      /*
       * The service answers 550 after DATA when none of the vaults carrying the address published an email delivery
       * key, so a failure here (and not a missing email later) means the vault never created its keypair.
       */
      await sendMail({
        from: 'sender@example.com',
        to: address,
        subject,
        text: 'This is a test email plain.',
        html: '<html><body><h1>Test Email</h1><p>Link: <a href="https://example.com">Example</a></p></body></html>',
      });
    });

    await test.step('the email shows decrypted on the item page', async () => {
      await page.locator('#recent-email-refresh').click();
      await expect(page.getByText(subject)).toBeVisible();
    });

    await test.step('and on the emails page', async () => {
      await page.getByRole('link', { name: 'Emails', exact: true }).first().click();
      await expect(page).toHaveURL(/\/emails$/);
      // The page renders a mobile and a desktop list; only one of them is shown.
      await expect(page.getByText(subject).filter({ visible: true }).first()).toBeVisible();
    });
  });
});
