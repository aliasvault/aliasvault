/**
 * Category 70: Vault sharing between two clients (requires API)
 */
import { test, expect } from '../fixtures';
import { createTestUser, enableCapability } from '../helpers/test-api';

import type { WebApp } from '../fixtures/WebApp';

/**
 * The viewer's own account fingerprint, shown on the settings overview.
 */
async function ownAccountFingerprint(app: WebApp): Promise<string> {
  await app.openSettings();
  const code = (await app.page.locator('#own-account-fingerprint').innerText()).trim();
  expect(code).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/);
  return code;
}

/**
 * Create a top-level personal folder in the vault and open it.
 */
async function createFolder(app: WebApp, name: string): Promise<void> {
  await app.openVault();
  await app.page.locator('#new-folder-button').click();
  await app.page.locator('#folder-name').fill(name);
  await app.page.locator('#folder-name').press('Enter');
  await app.openFolder(name);
}

test.describe('70. Sharing', () => {
  test('70.1 should share an existing folder by inviting someone with their code, then share another folder without it', async ({ app: owner, newApp, apiUrl }) => {
    test.slow();
    const folderName = 'Household';
    const renamedFolderName = 'Household shared';
    const secondFolderName = 'Streaming';
    const itemName = 'Shared item';
    const laterItemName = 'Later item';
    const ownerUser = await createTestUser(apiUrl);
    const memberUser = await createTestUser(apiUrl);

    await test.step('enable the sharing capability on the server', async () => {
      await enableCapability(apiUrl, ownerUser.username, 'vault-sharing');
      await enableCapability(apiUrl, memberUser.username, 'vault-sharing');
    });

    const member = await newApp();
    await test.step('log in both clients', async () => {
      await owner.login(ownerUser.username, ownerUser.password);
      await member.login(memberUser.username, memberUser.password);
    });

    await test.step('the owner has a personal folder with an item in it', async () => {
      await createFolder(owner, folderName);
      await owner.createItem(itemName);
      await owner.openFolder(folderName);
      await expect(owner.page.getByText(itemName, { exact: true })).toBeVisible();
    });

    let memberFingerprint = '';
    await test.step('inviting from the folder\'s people dialog shares it first; a wrong code and the own code are refused', async () => {
      memberFingerprint = await ownAccountFingerprint(member);
      const ownerFingerprint = await ownAccountFingerprint(owner);
      await owner.openFolder(folderName);
      await owner.page.locator('#folder-people').click();
      await expect(owner.page.getByText('Invite people to share this folder with them.', { exact: false })).toBeVisible();
      // The folder stays personal until the first invitation goes out; the wizard asks for the code first.
      await owner.page.locator('#invite-someone-new').click();
      const wrongCode = `${memberFingerprint.slice(0, -1)}${memberFingerprint.endsWith('0') ? '1' : '0'}`;
      await owner.page.locator('#invite-wizard-fingerprint').fill(wrongCode);
      await owner.page.locator('#invite-wizard-next').click();
      await expect(owner.page.getByText('No account has this account fingerprint.', { exact: false })).toBeVisible();
      await owner.page.locator('#invite-wizard-fingerprint').fill(ownerFingerprint);
      await owner.page.locator('#invite-wizard-next').click();
      await expect(owner.page.getByText('This is your own account fingerprint.', { exact: false })).toBeVisible();
      await owner.pause();
    });

    await test.step('the owner invites the member with their account fingerprint', async () => {
      await owner.page.locator('#invite-wizard-fingerprint').fill(memberFingerprint);
      await owner.page.locator('#invite-wizard-next').click();
      await expect(owner.page.getByText(`You are about to share “${folderName}” with ${memberUser.username}.`, { exact: false })).toBeVisible();
      await owner.page.locator('#invite-wizard-confirm').click();
      await expect(owner.page.getByText('Next step: share your account fingerprint')).toBeVisible();
      await expect(owner.page.locator('#invite-wizard-close')).toBeEnabled({ timeout: 5000 });
      await owner.page.locator('#invite-wizard-close').click();
      await expect(owner.page.locator(`[data-person="${memberUser.username}"]`)).toContainText('Invited');
      await owner.page.getByRole('button', { name: 'Close' }).click();
      await expect(owner.page.getByText(itemName, { exact: true })).toBeVisible();
      await owner.pause();
    });

    await test.step('the member sees the invitation in their folder list and accepts it with the owner\'s code', async () => {
      const ownerFingerprint = await ownAccountFingerprint(owner);
      await member.openVault();
      await expect(async () => {
        await member.page.getByRole('button', { name: 'Refresh' }).click();
        await expect(member.page.locator('[data-invitation]')).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30000 });
      await member.page.locator('[data-invitation]').click();
      await expect(member.page.getByText(`${ownerUser.username} shared “${folderName}” with you`)).toBeVisible();
      await member.page.locator('#accept-invitation').click();
      await expect(member.page.getByText(`Confirm the invitation from ${ownerUser.username}`)).toBeVisible();
      const wrongCode = `${ownerFingerprint.slice(0, -1)}${ownerFingerprint.endsWith('0') ? '1' : '0'}`;
      await member.page.locator('#inviter-fingerprint').fill(wrongCode);
      await member.page.locator('#accept-invitation').click();
      await expect(member.page.getByText('This account fingerprint is not correct.', { exact: false })).toBeVisible();
      await member.page.locator('#inviter-fingerprint').fill(ownerFingerprint);
      await member.page.locator('#accept-invitation').click();
      await expect(member.page).toHaveURL(/\/items\/folder\//);
      await expect(member.page.getByText(itemName, { exact: true })).toBeVisible();
      await member.pause();
    });

    await test.step('the owner renames the shared folder and adds an item, which the member sees', async () => {
      await owner.openFolder(folderName);
      await owner.page.getByTitle('Edit Folder').click();
      await owner.page.locator('#folder-name').fill(renamedFolderName);
      await owner.page.locator('#folder-name').press('Enter');
      await owner.createItem(laterItemName);

      await expect(async () => {
        await member.openVault();
        await member.page.getByRole('button', { name: 'Refresh' }).click();
        await expect(member.page.getByRole('button', { name: renamedFolderName })).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30000 });
      await member.openFolder(renamedFolderName);
      await expect(member.page.getByText(laterItemName, { exact: true })).toBeVisible();
      await member.pause();
    });

    await test.step('a second folder goes to the verified member without a code', async () => {
      await createFolder(owner, secondFolderName);
      await owner.page.locator('#folder-people').click();
      // Somebody verified before is picked in the wizard instead of entering their code.
      await owner.page.locator('#invite-someone-new').click();
      await owner.page.locator(`[data-person-option="${memberUser.username}"]`).click();
      await owner.page.locator('#invite-wizard-next').click();
      await expect(owner.page.getByText(`You are about to share “${secondFolderName}” with ${memberUser.username}.`, { exact: false })).toBeVisible();
      await owner.page.locator('#invite-wizard-confirm').click();
      await expect(owner.page.locator('#invite-wizard-close')).toBeVisible();
      await expect(owner.page.locator('#invite-wizard-close')).toBeEnabled({ timeout: 5000 });
      await owner.page.locator('#invite-wizard-close').click();
      await expect(owner.page.getByText(`Invitation sent to ${memberUser.username}.`)).toBeVisible();
      await expect(owner.page.locator(`[data-person="${memberUser.username}"]`)).toContainText('Invited');
      await owner.page.getByRole('button', { name: 'Close' }).click();

      await expect(async () => {
        await member.openVault();
        await member.page.getByRole('button', { name: 'Refresh' }).click();
        await expect(member.page.locator('[data-invitation]')).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30000 });
      await member.page.locator('[data-invitation]').click();
      await expect(member.page.getByText(`Invited by ${ownerUser.username}`)).toBeVisible();
      await member.page.locator('#accept-invitation').click();
      await expect(member.page).toHaveURL(/\/items\/folder\//);
      await expect(member.page.locator('#inviter-fingerprint')).toHaveCount(0);
      await member.pause();
    });

    await test.step('the member leaves the first folder with their master password and loses it', async () => {
      await member.openFolder(renamedFolderName);
      await member.page.locator('#folder-people').click();
      await member.page.getByRole('button', { name: 'Leave folder' }).click();
      await member.page.locator('#confirmButton').click();
      await member.page.locator('#password-confirm').fill(memberUser.password);
      await member.page.getByRole('button', { name: 'Confirm' }).click();
      await member.openVault();
      await expect(member.page.getByRole('button', { name: renamedFolderName })).toHaveCount(0);
      await expect(member.page.getByRole('button', { name: secondFolderName })).toBeVisible();
      await member.pause();
    });

    await test.step('with nobody else left, the first folder is personal again by itself and keeps its items', async () => {
      await owner.openFolder(renamedFolderName);
      await owner.page.locator('#folder-people').click();
      // The page moves from the shared folder (manifest id twice) to the personal folder it turned back into.
      await expect(owner.page).not.toHaveURL(/\/items\/folder\/([0-9a-f-]{36})\/\1$/, { timeout: 15000 });
      await expect(owner.page.getByText('Invite people to share this folder with them.', { exact: false })).toBeVisible();
      await owner.page.getByRole('button', { name: 'Close' }).click();
      await expect(owner.page.getByText(itemName, { exact: true })).toBeVisible();
      await expect(owner.page.getByText(laterItemName, { exact: true })).toBeVisible();
      await owner.pause();
    });

    await test.step('removing the last other person from the second folder makes it personal again', async () => {
      await owner.openFolder(secondFolderName);
      await owner.page.locator('#folder-people').click();
      await owner.page.getByRole('listitem').filter({ hasText: memberUser.username }).getByRole('button', { name: 'Remove access' }).click();
      await owner.page.locator('#confirmButton').click();
      await owner.page.locator('#password-confirm').fill(ownerUser.password);
      await owner.page.getByRole('button', { name: 'Confirm' }).click();
      await expect(owner.page).not.toHaveURL(/\/items\/folder\/([0-9a-f-]{36})\/\1$/, { timeout: 15000 });
      await expect(owner.page.getByText('Invite people to share this folder with them.', { exact: false })).toBeVisible();
      await owner.page.getByRole('button', { name: 'Close' }).click();
      await owner.pause();
    });
  });
});
