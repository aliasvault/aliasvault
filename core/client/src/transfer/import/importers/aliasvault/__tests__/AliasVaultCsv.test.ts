import { describe, expect, it } from 'vitest';

import { readFixtureText, byName, utc } from '../../../__tests__/testHelpers';
import { AliasVaultCsvImportService } from '../AliasVaultCsvImportService';

describe('AliasVaultCsvImportService', () => {
  it('imports a legacy CSV without credit card columns', () => {
    const legacyCsv =
      'ServiceName,FolderPath,ServiceUrl,Username,CurrentPassword,AliasEmail,TwoFactorSecret,AliasGender,AliasFirstName,AliasLastName,AliasNickName,AliasBirthDate,Notes,CreatedAt,UpdatedAt\n'
      + 'Old Service,,https://old.example,olduser,oldpass,,,,,,,,,2024-01-01 00:00:00,2024-01-01 00:00:00\n';

    const imported = AliasVaultCsvImportService.importItemsFromCsv(legacyCsv);

    expect(imported).toHaveLength(1);
    expect(imported[0].ServiceName).toBe('Old Service');
    expect(imported[0].Username).toBe('olduser');
    expect(imported[0].ItemType).toBeUndefined();
    expect(imported[0].Creditcard).toBeUndefined();
  });

  it('imports the mobile app CSV export', () => {
    const imported = AliasVaultCsvImportService.importItemsFromCsv(readFixtureText(import.meta.dirname, 'aliasvault_mobile_app_export.csv'));

    expect(imported).toHaveLength(3);

    const credential3 = byName(imported, 'credential3');
    expect(credential3.ServiceUrls?.[0]).toBeUndefined();
    expect(credential3.Username).toBe('username3');
    expect(credential3.Password).toBe('');
    expect(credential3.Notes).toBe('without password');
    expect(credential3.TwoFactorSecret).toBe('test');
    expect(credential3.CreatedAt?.toISOString().substring(0, 10)).toBe('2025-09-12');
    expect(credential3.UpdatedAt?.toISOString().substring(0, 10)).toBe('2025-09-12');
    expect(credential3.Alias?.Gender).toBe('');
    expect(credential3.Alias?.FirstName).toBe('');
    expect(credential3.Alias?.LastName).toBe('');
    expect(credential3.Email).toBe('');

    const service2 = byName(imported, 'service2');
    expect(service2.ServiceUrls?.[0]).toBe('https://service2.com');
    expect(service2.Username).toBe('username2');
    expect(service2.Password).toBe('password2');
    expect(service2.Notes).toBe('');
    expect(service2.TwoFactorSecret).toBe('');
    expect(service2.Email).toBe('service2@example.tld');
    expect(service2.Alias?.Gender).toBe('gender2');
    expect(service2.Alias?.FirstName).toBe('firstname2');
    expect(service2.Alias?.LastName).toBe('lastname2');

    const service1 = byName(imported, 'service1');
    expect(service1.ServiceUrls?.[0]).toBeUndefined();
    expect(service1.Username).toBe('username1');
    expect(service1.Password).toBe('password1');
    expect(service1.Notes).toBe('notes1');
    expect(service1.TwoFactorSecret).toBe('');
    expect(service1.Email).toBe('email1@example.tld');
    expect(service1.Alias?.Gender).toBe('gender1');
    expect(service1.Alias?.FirstName).toBe('firstname1');
    expect(service1.Alias?.LastName).toBe('lastname1');
    expect(service1.Alias?.BirthDate?.getTime()).toBe(utc(1970, 1, 1).getTime());
  });

  it('imports a CSV whose ServiceUrl column holds several URLs with spaces', () => {
    const csv =
      'ServiceName,FolderPath,ServiceUrl,Username,CurrentPassword,AliasEmail,TwoFactorSecret,AliasGender,AliasFirstName,AliasLastName,AliasNickName,AliasBirthDate,Notes,CreatedAt,UpdatedAt\n'
      + 'Multi url service,,"https://example.com, https://www.example.com",user,pass,,,,,,,,,2024-01-01 00:00:00,2024-01-01 00:00:00\n'
      + 'Single url service,,https://single.example,user,pass,,,,,,,,,2024-01-01 00:00:00,2024-01-01 00:00:00\n';

    const imported = AliasVaultCsvImportService.importItemsFromCsv(csv);

    expect(imported).toHaveLength(2);
    expect(byName(imported, 'Multi url service').ServiceUrls).toEqual(['https://example.com', 'https://www.example.com']);
    expect(byName(imported, 'Single url service').ServiceUrls).toEqual(['https://single.example']);
  });
});
