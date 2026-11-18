import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importProtonPassCsv } from '../ProtonPassCsvImporter';

describe('ProtonPassCsvImporter', () => {
  it('imports a Proton Pass CSV export', () => {
    const imported = importProtonPassCsv(readFixtureText(import.meta.dirname, 'protonpass.csv'));
    // The CSV has no item state, so the trashed item is in it too. It has no folders, attachments or passkeys, and no custom fields.
    expect(imported).toHaveLength(16);
    // The "Personal" vault is promoted to root.
    expect(imported.every(credential => credential.FolderPath === null)).toBe(true);
    expect(imported.filter(credential => credential.CustomFieldValues).map(credential => credential.ServiceName)).toEqual(['Avery']);
    expect(byName(imported, 'AV Login Trashed').Password).toBe('Pw-Trashed-16!');

    const basic = byName(imported, 'AV Login Basic');
    expect(basic.ItemType).toBe(ItemTypes.Login);
    expect(basic.Username).toBe('av-basic');
    expect(basic.Password).toBe('Pw-Basic-1!');
    expect(basic.ServiceUrls).toEqual(['https://login.example.com/']);
    expect(basic.Notes).toBe('Basic note');

    // The CSV leaves out the totp field Proton Pass keeps the TOTP of a login in.
    const totp = byName(imported, 'AV Login TOTP');
    expect(totp.Email).toBe('av-totp@example.com');
    expect(totp.Username).toBe('');
    expect(totp.Password).toBe('Pw-Totp-2!');
    expect(totp.TwoFactorSecret).toBe('');

    expect(byName(imported, 'AV Login Multi URL').ServiceUrls).toEqual(['https://a.example.com/', 'https://b.example.org/login', 'https://c.example.net:8443/']);
    expect(byName(imported, 'AV Login Passkey').Notes).toBe('Autosaved on https://webauthn.io/');

    expect(byName(imported, 'AV Login Folder').Password).toBe('Pw-Folder-7!');
    expect(byName(imported, 'AV Login Empty Password').Password).toBe('');

    const special = byName(imported, 'AV Login Special Chars äöü 日本');
    expect(special.Username).toBe('av-spécial, "quoted"');
    expect(special.Password).toBe('Pw,"10";\'\\ €ü');
    expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
    expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

    expect(byName(imported, 'AV Login No URL').ServiceUrls).toBeNull();

    // A credit card or identity row holds its content and note as JSON in the note column.
    const card = byName(imported, 'AV Card');
    expect(card.ItemType).toBe(ItemTypes.CreditCard);
    expect(card.Notes).toBe('Card note');
    expect(card.Creditcard).toEqual({ CardholderName: 'AV Cardholder', Number: '4111111111111111', Cvv: '123', Pin: '4321', ExpiryMonth: '12', ExpiryYear: '2030' });

    const identity = byName(imported, 'Avery');
    expect(identity.ItemType).toBe(ItemTypes.Alias);
    expect(identity.Notes).toBeNull();
    expect(identity.Alias).toEqual({ FirstName: 'Avery', LastName: 'Vault' });
    expect(identity.CustomFieldValues?.map(field => `${field.Label}=${field.Value} (${field.FieldType})`)).toEqual(['Phone=+31201234567 (Phone)', 'Address=Examplestreet 1, Exampletown, Noord-Holland, 1234 AB, Netherlands (Text)']);

    const note = byName(imported, 'AV Note');
    expect(note.ItemType).toBe(ItemTypes.Note);
    expect(note.Notes).toBe('Short secure note');
    expect(byName(imported, 'AV Note Long').Notes).toBe(new Array(100).fill('0123456789 The quick brown fox jumps over the lazy dog.').join('\n'));
  });

  it('reads the totp column, aliases and other vaults as folders, without an autofillUrls column', () => {
    const csv = [
      'type,name,url,email,username,password,note,totp,createTime,modifyTime,vault',
      'login,With TOTP,https://totp.example.com/,,user,pw,,otpauth://totp/AV?secret=JBSWY3DPEHPK3PXP,1,1,Personal',
      'alias,Alias,,alias.123@passinbox.com,,,,,1,1,Work',
    ].join('\n');

    const imported = importProtonPassCsv(csv);

    const withTotp = byName(imported, 'With TOTP');
    expect(withTotp.TwoFactorSecret).toBe('otpauth://totp/AV?secret=JBSWY3DPEHPK3PXP');
    expect(withTotp.ServiceUrls).toEqual(['https://totp.example.com/']);
    expect(withTotp.FolderPath).toBeNull();
    const alias = byName(imported, 'Alias');
    expect(alias.ItemType).toBe(ItemTypes.Login);
    expect(alias.Email).toBe('alias.123@passinbox.com');
    expect(alias.FolderPath).toBe('Work');
  });

  it('reads every website URL from the autofillUrls column', () => {
    const autofillUrls = JSON.stringify([{ url: 'https://default.example.com/', mode: 0 }, { url: 'https://exact.example.com/', mode: 1 }, { url: 'https://never.example.com/', mode: 2 }, { url: '^https://re', mode: 5 }]);
    const csv = [
      'type,name,url,autofillUrls,email,username,password,note,totp,createTime,modifyTime,vault',
      `login,With modes,https://default.example.com/,"${autofillUrls.replace(/"/g, '""')}",,user,pw,,,1,1,Personal`,
      'login,Without modes,"https://a.example.com/, https://b.example.com/",,,user,pw,,,1,1,Personal',
    ].join('\n');

    const imported = importProtonPassCsv(csv);

    expect(byName(imported, 'With modes').ServiceUrls).toEqual(['https://default.example.com/', 'https://exact.example.com/']);
    expect(byName(imported, 'Without modes').ServiceUrls).toEqual(['https://a.example.com/', 'https://b.example.com/']);
  });
});
