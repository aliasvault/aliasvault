import { TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { convertToItems, itemByName } from '../../__tests__/testHelpers';

import type { ImportedCredential } from '../../models/ImportedCredential';

describe('convertToItem', () => {
  it('keeps the TOTP parameters of an imported otpauth URI', () => {
    const credentials: ImportedCredential[] = [
      { ServiceName: 'Sha512Service', TwoFactorSecret: 'otpauth://totp/Sha512Service:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Sha512Service&algorithm=SHA512&digits=8&period=60' },
      { ServiceName: 'PlainService', TwoFactorSecret: 'JBSWY3DPEHPK3PXP' },
    ];

    const items = convertToItems(credentials);

    const withParameters = itemByName(items, 'Sha512Service').TotpCodes[0];
    const withDefaults = itemByName(items, 'PlainService').TotpCodes[0];
    expect(withParameters.Algorithm).toBe('SHA512');
    expect(withParameters.Digits).toBe(8);
    expect(withParameters.Period).toBe(60);
    expect(withDefaults.Algorithm).toBe(TOTP_DEFAULT_ALGORITHM);
    expect(withDefaults.Digits).toBe(TOTP_DEFAULT_DIGITS);
    expect(withDefaults.Period).toBe(TOTP_DEFAULT_PERIOD);
  });

  it('assigns folders when converting to items', () => {
    const credentials: ImportedCredential[] = [
      { ServiceName: 'Test Service', FolderPath: 'Work/Projects', Username: 'user1', Password: 'pass1' },
      { ServiceName: 'Test Service 2', FolderPath: 'Personal', Username: 'user2', Password: 'pass2' },
      { ServiceName: 'No Folder', Username: 'user3', Password: 'pass3' },
    ];
    const folderMapping = new Map([['Work/Projects', crypto.randomUUID()], ['Personal', crypto.randomUUID()]]);

    const items = convertToItems(credentials, folderMapping);

    expect(items[0].FolderId).toBe(folderMapping.get('Work/Projects'));
    expect(items[1].FolderId).toBe(folderMapping.get('Personal'));
    expect(items[2].FolderId).toBeNull();
  });
});
