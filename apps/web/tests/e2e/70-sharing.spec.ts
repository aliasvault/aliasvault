/**
 * Category 70: Vault sharing between two clients (requires API)
 */
import { test, expect } from '../fixtures';
import { createSharedGroup, createTestUser, enableCapability } from '../helpers/test-api';

test.describe('70. Sharing', () => {
  test('70.1 should show an item created in a shared vault to the invited member', async ({ app: owner, newApp, apiUrl }) => {
    test.slow();
    const vaultName = 'E2E shared vault';
    const itemName = 'Shared item';
    const ownerUser = await createTestUser(apiUrl);
    const memberUser = await createTestUser(apiUrl);
    let groupId = '';
    let manifestId = '';

    await test.step('set up the group and its sharing capability on the server', async () => {
      groupId = await createSharedGroup(apiUrl, 'E2E family', ownerUser.username, [memberUser.username]);
      await enableCapability(apiUrl, ownerUser.username, 'vault-sharing');
      await enableCapability(apiUrl, memberUser.username, 'vault-sharing');
    });

    const member = await newApp();
    await test.step('log in both clients', async () => {
      await owner.login(ownerUser.username, ownerUser.password);
      await member.login(memberUser.username, memberUser.password);
    });

    await test.step('the owner creates a shared vault', async () => {
      await owner.openFamilySharing();
      await owner.page.locator(`#new-vault-name-${groupId}`).fill(vaultName);
      await owner.page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(owner.page.getByRole('link', { name: vaultName })).toBeVisible();
      await owner.pause();
    });

    await test.step('the owner invites the member', async () => {
      await owner.page.getByRole('listitem').filter({ hasText: memberUser.username }).getByRole('button', { name: 'Invite' }).click();
      await expect(owner.page.getByText(`Invitation sent to ${memberUser.username}.`)).toBeVisible();
      await owner.pause();
    });

    await test.step('the member accepts the invitation', async () => {
      await member.openFamilySharing();
      await member.page.getByRole('button', { name: 'Accept' }).click();
      await expect(member.page.getByRole('link', { name: vaultName })).toBeVisible();
      await member.pause();
    });

    await test.step('the owner creates an item in the shared vault', async () => {
      await owner.page.getByRole('link', { name: vaultName }).click();
      await expect(owner.page).toHaveURL(/\/items\/folder\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
      manifestId = owner.page.url().split('/').at(-2) ?? '';
      await owner.createItem(itemName);
      expect(owner.page.url()).toContain(`/items/${manifestId}/`);
      await owner.pause();
    });

    await test.step('the member sees the item after pulling', async () => {
      await member.page.getByRole('link', { name: vaultName }).click();
      await expect(member.page).toHaveURL(new RegExp(`/items/folder/${manifestId}/`));
      await expect(async () => {
        await member.page.getByRole('button', { name: 'Refresh' }).click();
        await expect(member.page.getByText(itemName, { exact: true })).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30000 });
      await member.pause();
    });

    await test.step('the item opens in the shared vault for the member', async () => {
      await member.page.getByText(itemName, { exact: true }).click();
      await member.expectItemView(itemName);
      expect(member.page.url()).toContain(`/items/${manifestId}/`);
      await member.pause();
    });
  });
});
