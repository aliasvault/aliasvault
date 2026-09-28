import { describe, expect, it } from 'vitest';

import { byName } from '../../../__tests__/testHelpers';
import { getGenericCsvTemplate, importGenericCsv } from '../GenericCsvImporter';

describe('GenericCsvImporter', () => {
  it('imports the generic CSV template', () => {
    const imported = importGenericCsv(new TextDecoder().decode(getGenericCsvTemplate()));
    expect(imported).toHaveLength(4);

    const gmail = byName(imported, 'Gmail');
    expect(gmail.ServiceUrls?.[0]).toBe('https://gmail.com');
    expect(gmail.Username).toBe('your.email@gmail.com');
    expect(gmail.Password).toBe('your_password');
    expect(gmail.Notes).toBe('Important email account');
    expect(gmail.TwoFactorSecret).toBe('');
    expect(gmail.FolderPath).toBe('Personal');

    const facebook = byName(imported, 'Facebook');
    expect(facebook.ServiceUrls?.[0]).toBe('https://facebook.com');
    expect(facebook.Username).toBe('your.username');
    expect(facebook.Password).toBe('your_password');
    expect(facebook.Notes).toBe('Social media account');
    expect(facebook.TwoFactorSecret).toBe('');
    expect(facebook.FolderPath).toBe('Personal/Social');

    const github = byName(imported, 'GitHub');
    expect(github.ServiceUrls?.[0]).toBe('https://github.com');
    expect(github.Username).toBe('developer_username');
    expect(github.Password).toBe('your_password');
    expect(github.Notes).toBe('Development platform');
    expect(github.TwoFactorSecret).toBe('your_totp_secret_here');
    expect(github.FolderPath).toBe('Work');

    const secureNote = byName(imported, 'Secure Note');
    expect(secureNote.ServiceUrls?.[0]).toBeUndefined();
    expect(secureNote.Username).toBe('');
    expect(secureNote.Password).toBe('');
    expect(secureNote.Notes).toBe('Important information or notes without login credentials');
    expect(secureNote.TwoFactorSecret).toBe('');
    expect(secureNote.FolderPath).toBeNull();
  });

  it('provides the generic CSV template', () => {
    const template = new TextDecoder().decode(getGenericCsvTemplate());
    expect(template).toContain('service_name,url,username,password,totp_secret,notes,folder');
    expect(template).toContain('Gmail');
    expect(template).toContain('Facebook');
    expect(template).toContain('GitHub');
    expect(template).toContain('Secure Note');
    expect(template).toContain('your.email@gmail.com');
    expect(template).toContain('your_totp_secret_here');
  });
});
