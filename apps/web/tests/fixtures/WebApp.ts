import { expect, test, type Locator, type Page } from '@playwright/test';

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
   * Log in from the start page and wait for the vault, finishing the tutorial an empty new vault opens with.
   */
  public async login(username: string, password: string): Promise<void> {
    await this.openStart();
    await this.page.getByRole('link', { name: 'Log in with existing account' }).click();
    await expect(this.page).toHaveURL(/\/user\/login$/);

    await this.submitLogin(username, password);

    /*
     * An empty vault without the tutorial done opens on /items and moves on to /welcome once the items page loaded,
     * so wait until the items page is done loading (or the tutorial shows) before looking at the URL.
     */
    await expect(async () => {
      expect(this.page.url()).toMatch(/\/(items|welcome)$/);
      await expect(this.page.locator('.aliasvault-spinner-inline')).toHaveCount(0, { timeout: 0 });
    }).toPass();
    if (this.page.url().endsWith('/welcome')) {
      await this.finishTutorial();
    }
    await this.expectVaultOpen(username);
  }

  /**
   * Click through the welcome tutorial; it marks the tutorial as done and continues to the items page.
   */
  public async finishTutorial(): Promise<void> {
    await expect(this.page).toHaveURL(/\/welcome$/);
    await this.page.getByRole('button', { name: 'Continue' }).click();
    await this.page.getByRole('button', { name: 'Continue' }).click();
    await this.page.getByRole('button', { name: 'Get Started' }).click();
  }

  /**
   * Fill in and submit the login form on the current page, without waiting for the result.
   */
  public async submitLogin(username: string, password: string): Promise<void> {
    await this.page.locator('#email').fill(username);
    await this.page.locator('#password').fill(password);
    await this.page.locator('#login-button').click();
  }

  /**
   * Wait until the vault is unlocked and the items page shows for the given user.
   */
  public async expectVaultOpen(username: string): Promise<void> {
    await expect(this.page).toHaveURL(/\/items$/);
    await expect(this.page.locator('#mobileMenuDropdown').getByText(username, { exact: true })).toBeAttached();
  }

  /**
   * Stop here and open the Playwright Inspector to look at the page, only in a `npm run test:e2e:p` run; a no-op otherwise.
   */
  public async pause(): Promise<void> {
    if (!process.env.E2E_PAUSE) {
      return;
    }
    test.info().setTimeout(0);
    await this.page.pause();
  }

  /**
   * Create a login item with only a name via the top bar widget, and wait for its view page.
   */
  public async createItem(name: string): Promise<void> {
    await this.page.locator('#quickIdentityButton').click();
    await this.page.locator('#serviceName').fill(name);
    await this.page.locator('#quickIdentitySubmit').click();
    await expect(this.page.locator('#service-name')).toHaveValue(name);
    await this.saveItemButton().click();
    await expect(this.page.getByText('Item created successfully')).toBeVisible();
    await this.expectItemView(name);
  }

  /**
   * Open the vault list via the top menu; a full page load (goto, reload) would lock the vault.
   */
  public async openVault(): Promise<void> {
    await this.page.getByRole('link', { name: 'Vault', exact: true }).click();
    await expect(this.page).toHaveURL(/\/items(\?.*)?$/);
  }

  /**
   * Wait until the view page of the item with the given name shows.
   */
  public async expectItemView(name: string): Promise<void> {
    await expect(this.page).toHaveURL(ITEM_VIEW_URL);
    await expect(this.page.getByRole('heading', { name, exact: true })).toBeVisible();
  }

  /**
   * The Save Item button of the add/edit page.
   */
  public saveItemButton(): Locator {
    return this.page.getByRole('button', { name: 'Save Item' }).first();
  }
}

/**
 * The view page of an item: /items/{manifestId}/{id}.
 */
export const ITEM_VIEW_URL = /\/items\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
