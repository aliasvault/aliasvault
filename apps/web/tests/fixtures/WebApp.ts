import { expect, type Page } from '@playwright/test';

/**
 * Page object for the web app: the user-level flows tests are written in.
 */
export class WebApp {
  /**
   * Wrap a page that runs the web app.
   */
  public constructor(public readonly page: Page) {}

  /**
   * Open the start page as a logged-out visitor.
   */
  public async openStart(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page).toHaveURL(/\/user\/start$/);
  }

  /**
   * Log out via the user menu and wait for the start page.
   */
  public async logout(): Promise<void> {
    await this.page.locator('#toggleMobileMenuButton').click();
    await this.page.locator('#mobileMenuDropdown').getByRole('link', { name: 'Log out' }).click();
    await expect(this.page).toHaveURL(/\/user\/start$/);
  }

  /**
   * Log in from the start page and wait for the vault.
   */
  public async login(username: string, password: string): Promise<void> {
    await this.openStart();
    await this.page.getByRole('link', { name: 'Log in with existing account' }).click();
    await expect(this.page).toHaveURL(/\/user\/login$/);

    await this.page.locator('#email').fill(username);
    await this.page.locator('#password').fill(password);
    await this.page.locator('#login-button').click();

    await this.expectVaultOpen(username);
  }

  /**
   * Wait until the vault is unlocked and the items page shows for the given user.
   */
  public async expectVaultOpen(username: string): Promise<void> {
    await expect(this.page).toHaveURL(/\/items$/);
    await expect(this.page.locator('#mobileMenuDropdown').getByText(username, { exact: true })).toBeAttached();
  }

}
