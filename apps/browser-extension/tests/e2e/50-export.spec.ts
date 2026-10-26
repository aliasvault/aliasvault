/**
 * Category 50: Vault export (Requires API + Authentication)
 *
 * These tests verify the .avux and .avex exports from the Import / Export settings page: the master password gate,
 * the export password step and that the downloaded files hold the vault.
 */
import { readFileSync } from 'node:fs';

import { AvexImportService } from '@aliasvault/client/transfer/import/importers/aliasvault/AvexImportService';
import { AvuxImportService } from '@aliasvault/client/transfer/import/importers/aliasvault/AvuxImportService';
import { ZipArchive } from '@aliasvault/client/transfer/shared/ZipArchive';

import { test, expect, TestClient, Timeouts } from '../fixtures';
import '../helpers/client-platform';

test.describe.serial('50. Vault export', () => {
  let client: TestClient;
  let masterPassword: string;
  const credentialName = `Export Login ${Date.now()}`;
  const exportPassword = `ExportPassword${Date.now()}!x`;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  /**
   * Start an export from the settings page: confirm the warning and enter the master password.
   */
  async function startExport(format: 'avux' | 'avex', password: string): Promise<void> {
    const { popup } = client;
    await popup.locator(`#export-${format}-button`).click();
    await popup.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(popup.locator('#confirm-master-password')).toBeVisible();
    await popup.fill('#confirm-master-password', password);
    await popup.getByRole('button', { name: 'Confirm', exact: true }).click();
  }

  test('50.1 should login, create a credential and open the export page', async ({ testUser, apiUrl }) => {
    masterPassword = testUser.password;
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);
    await client.goToVault().then((c) => c.createCredential(credentialName, 'export-user@example.com', 'ExportPassword123!'));

    await client.goToSettings();
    await client.popup.locator('#import-export-settings-button').click();
    await expect(client.popup.locator('#export-avex-button')).toBeVisible();
    await client.screenshot('50.1-export-page.png');
  });

  test('50.2 should reject a wrong master password', async () => {
    await startExport('avux', 'wrong-master-password');
    await expect(client.popup.getByText('The password you entered is incorrect')).toBeVisible({ timeout: Timeouts.LONG });
    await client.screenshot('50.2-wrong-master-password.png');
    await client.popup.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(client.popup.locator('#confirm-master-password')).toBeHidden();
  });

  test('50.3 should export the vault as .avux', async () => {
    const { popup } = client;
    const [download] = await Promise.all([popup.waitForEvent('download'), startExport('avux', masterPassword)]);
    expect(download.suggestedFilename()).toMatch(/^aliasvault-export-\d{4}-\d{2}-\d{2}\.avux$/);
    await expect(popup.getByText('exported successfully')).toBeVisible({ timeout: Timeouts.LONG });

    const avuxBytes = new Uint8Array(readFileSync(await download.path()));
    const manifest = JSON.parse(ZipArchive.open(avuxBytes).readText('manifest.json') ?? '{}');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.items.map((item: { name: string }) => item.name)).toContain(credentialName);
    await client.screenshot('50.3-avux-exported.png');
  });

  test('50.4 should export the vault as .avex and decrypt it with the export password', async () => {
    const { popup } = client;
    await startExport('avex', masterPassword);

    await expect(popup.locator('#export-password')).toBeVisible();
    await popup.fill('#export-password', exportPassword);
    await popup.fill('#confirm-export-password', exportPassword);
    await client.screenshot('50.4-export-password.png');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.locator('#create-encrypted-export-button').click()]);
    expect(download.suggestedFilename()).toMatch(/^aliasvault-export-\d{4}-\d{2}-\d{2}\.avex$/);
    await expect(popup.getByText('exported successfully')).toBeVisible({ timeout: Timeouts.LONG });

    const avexBytes = new Uint8Array(readFileSync(await download.path()));
    expect((await AvexImportService.parseAvexHeader(avexBytes)).format).toBe('avex');
    await expect(AvexImportService.decryptAvex(avexBytes, 'not-the-export-password')).rejects.toThrow();

    const avuxBytes = await AvexImportService.decryptAvex(avexBytes, exportPassword);
    const credentials = AvuxImportService.importFromAvux(avuxBytes);
    expect(credentials.map((credential) => credential.ServiceName)).toContain(credentialName);
    expect(credentials.find((credential) => credential.ServiceName === credentialName)?.Username).toBe('export-user@example.com');
    await client.screenshot('50.4-avex-exported.png');
  });
});
