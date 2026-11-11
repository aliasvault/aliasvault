/**
 * Category 23: Bulk item selection (Requires API + Authentication)
 *
 * Select several items in the vault list, move them into a folder and delete them in one go.
 */
import type { Locator } from '@playwright/test';

import { test, expect, TestClient, Timeouts } from '../fixtures';

test.describe('23. Bulk Selection', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('23.1 should move and delete several items at once', async ({ testUser, apiUrl }) => {
    const folderName = `Bulk folder ${Date.now()}`;
    client = await TestClient.create();
    const { popup } = client;

    /**
     * The row of an item in the vault list.
     */
    const card = (name: string): Locator => popup.locator('#items-list li[role="option"]', { hasText: name }).locator('button').first();
    const bar = popup.locator('#selection-action-bar');

    await test.step('log in and create three items', async () => {
      await client.login(apiUrl, testUser.username, testUser.password);
      await client.goToVault().then((c) => c.createCredential('Bulk one', 'one@example.com', 'Password1!'));
      await client.goToVault().then((c) => c.createCredential('Bulk two', 'two@example.com', 'Password2!'));
      await client.goToVault().then((c) => c.createCredential('Bulk keep', 'keep@example.com', 'Password3!'));
    });

    await test.step('create a folder', async () => {
      await client.goToVault();
      await popup.getByRole('button', { name: 'New Folder' }).click();
      await popup.locator('#folderName').fill(folderName);
      await popup.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(popup.locator('[role="listbox"] button', { hasText: folderName })).toBeVisible({ timeout: Timeouts.MEDIUM });
    });

    await test.step('select two items from the menu and move them into the folder', async () => {
      await popup.locator('#items-list-menu').click();
      await popup.locator('#list-select').click();
      await card('Bulk one').click();
      await card('Bulk one').click();
      // Selection mode turned on from the menu stays open with nothing selected.
      await expect(bar).toContainText('0 selected');
      await card('Bulk one').click();
      await card('Bulk two').click();
      await expect(bar).toContainText('2 selected');
      await popup.locator('#selection-move').click();
      await popup.getByRole('button', { name: folderName }).last().click();
      await expect(bar).toHaveCount(0, { timeout: Timeouts.MEDIUM });
      await expect(card('Bulk one')).toHaveCount(0);
      await expect(card('Bulk two')).toHaveCount(0);
      await expect(card('Bulk keep')).toBeVisible();
      await client.pause();
    });

    await test.step('the folder holds both items', async () => {
      await popup.locator('[role="listbox"] button', { hasText: folderName }).click();
      await expect(popup).toHaveURL(/\/items\/folder\//);
      await expect(card('Bulk one')).toBeVisible();
      await expect(card('Bulk two')).toBeVisible();
      await expect(card('Bulk keep')).toHaveCount(0);
    });

    await test.step('selection mode entered by Ctrl/Cmd+click closes when the last item is deselected', async () => {
      await card('Bulk one').click({ modifiers: ['ControlOrMeta'] });
      await expect(bar).toContainText('1 selected');
      await card('Bulk one').click({ modifiers: ['ControlOrMeta'] });
      await expect(bar).toHaveCount(0);
    });

    await test.step('select all in the folder and delete', async () => {
      await card('Bulk one').click({ modifiers: ['ControlOrMeta'] });
      await bar.getByRole('button', { name: 'Select all' }).click();
      await expect(bar).toContainText('2 selected');
      await expect(bar.getByRole('button', { name: 'Select all' })).toBeDisabled();
      await popup.locator('#selection-delete').click();
      await expect(popup.getByText('Delete 2 items?')).toBeVisible();
      await popup.getByRole('button', { name: 'Delete', exact: true }).last().click();
      await expect(bar).toHaveCount(0, { timeout: Timeouts.MEDIUM });
      await expect(card('Bulk one')).toHaveCount(0);
      await expect(card('Bulk two')).toHaveCount(0);
      await client.pause();
    });

    await test.step('the deleted items are in Recently Deleted and the moves survive a sync', async () => {
      await client.waitForServerSync().then((c) => c.triggerSync()).then((c) => c.goToVault());
      await expect(card('Bulk keep')).toBeVisible();
      await expect(card('Bulk one')).toHaveCount(0);
      await popup.goto(`chrome-extension://${client.extensionId}/popup.html#/items/deleted`);
      await expect(popup.getByText('Bulk one')).toBeVisible({ timeout: Timeouts.MEDIUM });
      await expect(popup.getByText('Bulk two')).toBeVisible();
    });
  });
});
