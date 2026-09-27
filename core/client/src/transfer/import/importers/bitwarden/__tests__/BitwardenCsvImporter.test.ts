import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it, vi } from 'vitest';

import { parseFolderPath } from '../../../../shared/FolderPaths';
import { readFixtureText, byName, itemByName } from '../../../__tests__/testHelpers';
import { collectHierarchicalFolderPaths } from '../../../writers/ImportDuplicateDetection';
import { convertToItems } from '../../../writers/ItemConverter';
import { importBitwardenCsv } from '../BitwardenCsvImporter';

import type { ImportedCredential } from '../../../models/ImportedCredential';

/**
 * Converts the Bitwarden fixture, which holds one invalid TOTP secret that the importer logs and skips.
 */
function convertBitwardenFixture(imported: ImportedCredential[]): ReturnType<typeof convertToItems> {
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const items = convertToItems(imported);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    return items;
  } finally {
    consoleWarn.mockRestore();
  }
}

describe('BitwardenCsvImporter', () => {
  it('imports Bitwarden CSV', () => {
    const imported = importBitwardenCsv(readFixtureText(import.meta.dirname, 'bitwarden.csv'));
    expect(imported).toHaveLength(12);

    // One entry has an invalid TOTP secret ("!" in it); conversion must not throw.
    const convertedItems = convertBitwardenFixture(imported);
    expect(itemByName(convertedItems, 'TutaNota4').TotpCodes).toHaveLength(0);
    expect(itemByName(convertedItems, 'TutaNota').TotpCodes).toHaveLength(1);
    expect(itemByName(convertedItems, 'TutaNota3').TotpCodes).toHaveLength(1);

    const tutaNota = byName(imported, 'TutaNota');
    expect(tutaNota.Username).toBe('avtest2@tutamail.com');
    expect(tutaNota.Password).toBe('blabla');
    expect(tutaNota.TwoFactorSecret).toBe('otpauth://totp/Strongbox?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&algorithm=SHA1&digits=6&period=30');

    const aliasVault = byName(imported, 'Aliasvault.com');
    expect(aliasVault.ServiceUrls?.[0]).toBe('https://www.aliasvault.com');
    expect(aliasVault.Username).toBe('root');
    expect(aliasVault.Password).toBe('toor');

    const multiUrl = byName(imported, 'TutaNota3');
    expect(multiUrl.ServiceUrls).toEqual(['https://www.aliasvault.com', 'https://app.aliasvault.com', 'https://downloads.aliasvault.com']);
    expect(multiUrl.Username).toBe('avtest3@tutamail.com');
    expect(multiUrl.TwoFactorSecret).toBe('otpauth://totp/Test%20name%3Atest%40test.org?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&issuer=Alias%20Vault');

    const multiUrlItem = itemByName(convertedItems, 'TutaNota3');
    const urlFieldValues = multiUrlItem.FieldValues.filter(fv => fv.FieldKey === FieldKey.LoginUrl).sort((a, b) => a.Weight - b.Weight);
    expect(urlFieldValues.map(fv => fv.Value)).toEqual(['https://www.aliasvault.com', 'https://app.aliasvault.com', 'https://downloads.aliasvault.com']);
    expect(urlFieldValues.map(fv => fv.Weight)).toEqual([0, 1, 2]);

    // The TOTP name is URL-decoded from the otpauth URI.
    const totp = multiUrlItem.TotpCodes[0];
    expect(totp).toBeDefined();
    expect(totp.SecretKey).toBe('PLW4SB3PQ7MKVXY2MXF4NEXS6Y');
    expect(totp.Name).toBe('Alias Vault: Test name:test@test.org');

    expect(byName(imported, 'ProjectItem').FolderPath).toBe('Work/Projects');
    expect(byName(imported, 'ActiveProjectItem').FolderPath).toBe('Work/Projects/Active');
    expect(byName(imported, 'BankAccount').FolderPath).toBe('Personal/Finance/Banking');
    expect(byName(imported, 'SavingsAccount').FolderPath).toBe('Personal/Finance/Banking/Savings');

    expect(parseFolderPath('Work/Projects/Active')).toEqual(['Work', 'Projects', 'Active']);
    expect(parseFolderPath('Personal/Finance/Banking/Savings')).toEqual(['Personal', 'Finance', 'Banking', 'Savings']);
  });

  it('imports Bitwarden folders', () => {
    const imported = importBitwardenCsv(readFixtureText(import.meta.dirname, 'bitwarden.csv'));
    expect(imported.filter(c => c.FolderPath === 'Business')).toHaveLength(6);
    expect(collectHierarchicalFolderPaths(imported)).toContain('Business');
  });

  it('detects Bitwarden item types', () => {
    const imported = importBitwardenCsv(readFixtureText(import.meta.dirname, 'bitwarden.csv'));
    const items = convertBitwardenFixture(imported);
    expect(items.filter(i => i.ItemType === ItemTypes.Login).length).toBeGreaterThan(0);
  });
});
