/**
 * Category 30: Import (requires API)
 */
import path from 'node:path';

import { test, expect, type WebApp } from '../fixtures';

/** A Bitwarden export of 16 items, one of which ("AV Login Passkey") holds a passkey. */
const BITWARDEN_EXPORT = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'core', 'client', 'src', 'transfer', 'import', 'importers', 'bitwarden', '__tests__', 'bitwarden.zip');
const PASSKEY_ITEM = 'AV Login Passkey';

/**
 * Open the Bitwarden import dialog and upload the export, up to the preview step.
 */
async function uploadBitwardenExport(app: WebApp): Promise<void> {
  await app.openSettingsPage('Import / Export');
  await expect(app.page).toHaveURL(/\/settings\/import-export$/);
  await app.page.locator('[data-import-service="Bitwarden"]').click();
  await app.page.locator('input[type="file"]').setInputFiles(BITWARDEN_EXPORT);
}

/**
 * Continue from the preview step, confirm the import and wait for the vault list.
 */
async function confirmImport(app: WebApp, successMessage: string): Promise<void> {
  await app.page.getByRole('button', { name: 'Next' }).click();
  await app.page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(app.page.getByText(successMessage)).toBeVisible();
  await expect(app.page).toHaveURL(/\/items$/);
}

/**
 * Open the view page of an item from the vault list.
 */
async function openItem(app: WebApp, name: string): Promise<void> {
  await app.openVault();
  await app.page.getByText(name, { exact: true }).click();
  await app.expectItemView(name);
}

test.describe('30. Import', () => {
  test.beforeEach(async ({ app, testUser }) => {
    await app.login(testUser.username, testUser.password);
  });

  test('30.1 should add data an existing item lacks when the same file is imported again', async ({ app }) => {
    const { page } = app;

    await test.step('import the export into the empty vault', async () => {
      await uploadBitwardenExport(app);
      await expect(page.getByText('16 new item(s) will be imported.')).toBeVisible();
      await page.getByLabel('Extract favicons for services with URLs').uncheck();
      await confirmImport(app, 'Successfully imported 16 credentials.');
    });

    await test.step('the imported item holds its passkey', async () => {
      await openItem(app, PASSKEY_ITEM);
      await expect(page.getByText('Passkey', { exact: true })).toBeVisible();
    });

    await test.step('delete the passkey of the item', async () => {
      await page.getByRole('link', { name: 'Edit item' }).click();
      await expect(page).toHaveURL(/\/edit$/);
      await page.getByTitle('Delete passkey').click();
      await app.saveItemButton().click();
      await expect(page.getByText('Item updated successfully')).toBeVisible();
      await app.expectItemView(PASSKEY_ITEM);
      await expect(page.getByText('Passkey', { exact: true })).toHaveCount(0);
    });

    await test.step('importing the file again offers to update that one item only', async () => {
      await uploadBitwardenExport(app);
      await expect(page.getByText('1 existing item(s) will be updated with new data.')).toBeVisible();
      await expect(page.getByText('15 duplicate credential(s) were found and will not be imported.')).toBeVisible();
      await expect(page.getByText('new item(s) will be imported')).toHaveCount(0);

      const row = page.getByRole('row', { name: PASSKEY_ITEM });
      await expect(row).toContainText('Passkeys');
      await expect(page.getByRole('columnheader', { name: 'Added' })).toBeVisible();
      await app.pause();
      await confirmImport(app, 'Success');
    });

    await test.step('the item holds its passkey again and no second copy was made', async () => {
      await expect(page.getByText(PASSKEY_ITEM, { exact: true })).toHaveCount(1);
      await openItem(app, PASSKEY_ITEM);
      await expect(page.getByText('Passkey', { exact: true })).toBeVisible();
      await expect(page.getByText('webauthn.io').first()).toBeVisible();
    });

    await test.step('a third import finds nothing left to add', async () => {
      await uploadBitwardenExport(app);
      await expect(page.getByText('16 duplicate credential(s) were found and will not be imported.')).toBeVisible();
      await expect(page.getByText('No new credentials were found to import.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    });
  });
});
