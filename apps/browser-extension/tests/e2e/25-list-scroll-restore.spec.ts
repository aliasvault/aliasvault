/**
 * Category 25: Scroll position (Requires API + Authentication)
 *
 * Going back to the items list shortly after opening an item returns to where the list was scrolled and marks the item.
 * Going back to the settings page from one of its pages returns to where it was scrolled.
 */
import { test, expect, TestClient, Timeouts } from '../fixtures';

test.describe.serial('25. Scroll position', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('25.1 should return to the scrolled position when going back from an item', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    const { popup } = client;
    const main = popup.locator('main');

    /**
     * Where the row of an item is drawn, from the top of the popup.
     */
    const rowTop = (name: string): Promise<number> => popup.locator('#items-list li[role="option"]', { hasText: name }).evaluate((el) => el.getBoundingClientRect().top);

    await test.step('log in and create enough items to scroll the list, one for the current site', async () => {
      await client.login(apiUrl, testUser.username, testUser.password);
      for (let i = 1; i <= 7; i++) {
        await client.goToVault().then((c) => c.createCredential(`Scroll item ${i}`, `user${i}`, 'a-long-password-123'));
      }
      await client.goToVault().then((c) => c.createCredentialWithUrl('Scroll item 8', 'user8', 'a-long-password-123', 'https://scroll-site.example.com'));
      // The current-site suggestion above the list shows up a moment after the list, here after the position is restored.
      await popup.evaluate(() => Object.assign(chrome.tabs, {
        query: async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return [{ url: 'https://scroll-site.example.com/' }];
        },
      }));
    });

    let rowTopBefore = 0;
    await test.step('scroll the list part way and open an item', async () => {
      await client.goToVault();
      await expect(popup.locator('#items-list li[role="option"]')).toHaveCount(8, { timeout: Timeouts.MEDIUM });
      await expect(popup.getByText('scroll-site.example.com')).toBeVisible();
      await main.evaluate((el) => {
        el.scrollTop = 100;
      });
      rowTopBefore = await rowTop('Scroll item 6');
      await client.itemCard('Scroll item 6').click();
      await expect(popup).toHaveURL(/\/items\/[^/]+\/[^/]+$/);
    });

    const marked = popup.locator('#items-list li[aria-current="true"]');

    await test.step('back returns to the same position, also once the suggestion has appeared, and marks the opened item', async () => {
      await client.pause();
      await popup.locator('button#back').click();
      await expect(popup).toHaveURL(/#\/items$/);
      await expect(popup.getByText('scroll-site.example.com')).toBeVisible();
      await expect.poll(async () => Math.abs(await rowTop('Scroll item 6') - rowTopBefore), { timeout: Timeouts.MEDIUM }).toBeLessThanOrEqual(1);
      await expect(marked).toHaveCount(1);
      await expect(marked).toContainText('Scroll item 6');
    });

    await test.step('the vault tab starts the list at the top, without a mark', async () => {
      await client.goToSettings();
      await client.goToVault();
      await expect(popup.locator('#items-list li[role="option"]')).toHaveCount(8, { timeout: Timeouts.MEDIUM });
      // A restore would land on the next frame; wait two.
      await popup.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await main.evaluate((el) => el.scrollTop)).toBe(0);
      await expect(marked).toHaveCount(0);
    });
  });

  test('25.2 should return to the scrolled position when going back to the settings page', async () => {
    const { popup } = client;
    const main = popup.locator('main');

    const importExport = popup.locator('#import-export-settings-button');
    let scrollTopBefore = 0;
    await test.step('scroll the settings page part way and open one of its pages', async () => {
      await client.goToSettings();
      await main.evaluate((el) => {
        el.scrollTop = 120;
      });
      // Open it by keyboard: a click first scrolls its target clear of the bottom bar, which moves the page.
      await importExport.focus();
      scrollTopBefore = await main.evaluate((el) => el.scrollTop);
      expect(scrollTopBefore).toBeGreaterThan(0);
      await importExport.press('Enter');
      await expect(importExport).toHaveCount(0);
    });

    await test.step('back returns to the same position', async () => {
      await popup.locator('button#back').click();
      await expect(importExport).toBeVisible();
      await expect.poll(async () => Math.abs(await main.evaluate((el) => el.scrollTop) - scrollTopBefore), { timeout: Timeouts.MEDIUM }).toBeLessThanOrEqual(1);
    });

    await test.step('the settings tab starts at the top', async () => {
      await client.goToVault();
      await client.goToSettings();
      await expect(importExport).toBeVisible();
      // A restore would land on the next frame; wait two.
      await popup.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await main.evaluate((el) => el.scrollTop)).toBe(0);
    });
  });
});
