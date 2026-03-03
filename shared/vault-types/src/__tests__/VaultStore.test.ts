import { describe, it, expect } from 'vitest';
import { VaultStore } from '../VaultStore';
import type { Credential, Attachment, TotpCode, EncryptionKey, Passkey } from '@aliasvault/models/vault';

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    Id: '',
    ServiceName: 'GitHub',
    ServiceUrl: 'https://github.com',
    Username: 'testuser',
    Password: 'secret123',
    Notes: 'my notes',
    Alias: {
      FirstName: 'John',
      LastName: 'Doe',
      NickName: 'jd',
      BirthDate: '1990-01-01 00:00:00',
      Gender: 'male',
      Email: 'john@example.com',
    },
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    Id: crypto.randomUUID().toUpperCase(),
    Filename: 'test.txt',
    Blob: new Uint8Array([72, 101, 108, 108, 111]),
    CredentialId: '',
    CreatedAt: '',
    UpdatedAt: '',
    ...overrides,
  };
}

function makeTotpCode(overrides: Partial<TotpCode> = {}): TotpCode {
  return {
    Id: crypto.randomUUID().toUpperCase(),
    Name: 'GitHub TOTP',
    SecretKey: 'JBSWY3DPEHPK3PXP',
    CredentialId: '',
    ...overrides,
  };
}

// --- 3.1 Serialization roundtrip ---
describe('Serialization roundtrip', () => {
  it('createEmpty → mutations → toJson → fromJson preserves state', async () => {
    const store = VaultStore.createEmpty();
    const id = await store.createCredential(makeCredential(), []);
    store.setSetting('theme', 'dark');
    store.addEncryptionKey({ Id: 'ek1', PublicKey: 'pub', PrivateKey: 'priv', IsPrimary: true });

    const json = store.toJson();
    const restored = VaultStore.fromJson(json);

    expect(restored.getAllCredentials()).toHaveLength(1);
    expect(restored.getCredentialById(id)?.ServiceName).toBe('GitHub');
    expect(restored.getSetting('theme')).toBe('dark');
    expect(restored.getAllEncryptionKeys()).toHaveLength(1);
  });

  it('toJson stamps version 1', () => {
    const store = VaultStore.createEmpty();
    const parsed = JSON.parse(store.toJson());
    expect(parsed.version).toBe(1);
  });

  it('toJson stamps lastModified as Unix timestamp', () => {
    const store = VaultStore.createEmpty();
    const before = Date.now();
    const parsed = JSON.parse(store.toJson());
    const after = Date.now();
    expect(typeof parsed.lastModified).toBe('number');
    expect(parsed.lastModified).toBeGreaterThanOrEqual(before);
    expect(parsed.lastModified).toBeLessThanOrEqual(after);
  });
});

// --- 3.2 All CRUD ---
describe('Credential CRUD', () => {
  it('createCredential returns UUID and credential is retrievable', async () => {
    const store = VaultStore.createEmpty();
    const id = await store.createCredential(makeCredential(), []);
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9A-F-]+$/);

    const cred = store.getCredentialById(id);
    expect(cred).not.toBeNull();
    expect(cred!.ServiceName).toBe('GitHub');
    expect(cred!.Username).toBe('testuser');
    expect(cred!.Password).toBe('secret123');
    expect(cred!.Alias.FirstName).toBe('John');
  });

  it('getAllCredentials returns non-deleted credentials sorted by createdAt DESC', async () => {
    const store = VaultStore.createEmpty();
    await store.createCredential(makeCredential({ ServiceName: 'First' }), []);
    // Ensure different timestamp (ms precision)
    await new Promise(resolve => setTimeout(resolve, 10));
    await store.createCredential(makeCredential({ ServiceName: 'Second' }), []);

    const all = store.getAllCredentials();
    expect(all).toHaveLength(2);
    expect(all[0].ServiceName).toBe('Second');
    expect(all[1].ServiceName).toBe('First');
  });

  it('updateCredentialById updates fields', async () => {
    const store = VaultStore.createEmpty();
    const id = await store.createCredential(makeCredential(), []);

    const updated = makeCredential({
      Id: id,
      ServiceName: 'Updated GitHub',
      Password: 'newpassword',
      Username: 'newuser',
    });
    const result = await store.updateCredentialById(updated, [], []);
    expect(result).toBe(1);

    const cred = store.getCredentialById(id);
    expect(cred!.ServiceName).toBe('Updated GitHub');
    expect(cred!.Password).toBe('newpassword');
    expect(cred!.Username).toBe('newuser');
  });

  it('deleteCredentialById soft-deletes', async () => {
    const store = VaultStore.createEmpty();
    const id = await store.createCredential(makeCredential(), []);
    expect(store.getAllCredentials()).toHaveLength(1);

    const result = await store.deleteCredentialById(id);
    expect(result).toBe(1);
    expect(store.getAllCredentials()).toHaveLength(0);
    expect(store.getCredentialById(id)).toBeNull();
  });

  it('getCredentialById returns null for non-existent id', () => {
    const store = VaultStore.createEmpty();
    expect(store.getCredentialById('nonexistent')).toBeNull();
  });
});

describe('Attachment CRUD', () => {
  it('create credential with attachments and retrieve them', async () => {
    const store = VaultStore.createEmpty();
    const att = makeAttachment();
    const id = await store.createCredential(makeCredential(), [att]);

    const attachments = store.getAttachmentsForCredential(id);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].Filename).toBe('test.txt');
    expect(attachments[0].Blob).toBeInstanceOf(Uint8Array);
    expect(Array.from(attachments[0].Blob as Uint8Array)).toEqual([72, 101, 108, 108, 111]);
  });

  it('update adds new attachments and soft-deletes removed ones', async () => {
    const store = VaultStore.createEmpty();
    const att1 = makeAttachment({ Filename: 'file1.txt' });
    const id = await store.createCredential(makeCredential(), [att1]);

    const stored = store.getAttachmentsForCredential(id);
    const origId = stored[0].Id;

    const att2 = makeAttachment({ Filename: 'file2.txt' });
    await store.updateCredentialById(
      makeCredential({ Id: id }),
      [origId],
      [att2]
    );

    const updated = store.getAttachmentsForCredential(id);
    expect(updated).toHaveLength(1);
    expect(updated[0].Filename).toBe('file2.txt');
  });

  it('getAttachmentsForCredential returns empty for unknown credential', () => {
    const store = VaultStore.createEmpty();
    expect(store.getAttachmentsForCredential('nope')).toEqual([]);
  });
});

describe('TOTP CRUD', () => {
  it('create credential with TOTP codes and retrieve them', async () => {
    const store = VaultStore.createEmpty();
    const totp = makeTotpCode();
    const id = await store.createCredential(makeCredential(), [], [totp]);

    const codes = store.getTotpCodesForCredential(id);
    expect(codes).toHaveLength(1);
    expect(codes[0].Name).toBe('GitHub TOTP');
    expect(codes[0].SecretKey).toBe('JBSWY3DPEHPK3PXP');
  });

  it('update adds, updates, and deletes TOTP codes', async () => {
    const store = VaultStore.createEmpty();
    const totp1 = makeTotpCode({ Name: 'Original' });
    const id = await store.createCredential(makeCredential(), [], [totp1]);

    const origCodes = store.getTotpCodesForCredential(id);
    const origTotpId = origCodes[0].Id;

    const updatedTotp = makeTotpCode({ Id: origTotpId, Name: 'Updated', SecretKey: 'NEWSECRET' });
    const newTotp = makeTotpCode({ Name: 'New TOTP' });

    await store.updateCredentialById(
      makeCredential({ Id: id }),
      [],
      [],
      [origTotpId],
      [updatedTotp, newTotp]
    );

    const codes = store.getTotpCodesForCredential(id);
    expect(codes).toHaveLength(2);
    const updated = codes.find(c => c.Id === origTotpId);
    expect(updated?.Name).toBe('Updated');
    expect(updated?.SecretKey).toBe('NEWSECRET');
  });

  it('skips deleted TOTP codes on create', async () => {
    const store = VaultStore.createEmpty();
    const totp = makeTotpCode({ IsDeleted: true });
    const id = await store.createCredential(makeCredential(), [], [totp]);
    expect(store.getTotpCodesForCredential(id)).toHaveLength(0);
  });
});

describe('Passkey CRUD', () => {
  it('createPasskey and retrieve by rpId', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);

    await store.createPasskey({
      Id: 'pk1',
      CredentialId: credId,
      RpId: 'github.com',
      PublicKey: 'pubkey',
      PrivateKey: 'privkey',
      DisplayName: 'My Key',
    });

    const byRpId = store.getPasskeysByRpId('github.com');
    expect(byRpId).toHaveLength(1);
    expect(byRpId[0].DisplayName).toBe('My Key');
    expect(byRpId[0].Username).toBe('testuser');
    expect(byRpId[0].ServiceName).toBe('GitHub');
  });

  it('getPasskeysByCredentialId returns passkeys', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);
    await store.createPasskey({
      Id: 'pk1',
      CredentialId: credId,
      RpId: 'github.com',
      PublicKey: 'pub',
      PrivateKey: 'priv',
      DisplayName: 'Key',
    });

    const passkeys = store.getPasskeysByCredentialId(credId);
    expect(passkeys).toHaveLength(1);
    expect(passkeys[0].Id).toBe('pk1');
  });

  it('getPasskeyById returns passkey with credential info', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);
    await store.createPasskey({
      Id: 'pk1',
      CredentialId: credId,
      RpId: 'github.com',
      PublicKey: 'pub',
      PrivateKey: 'priv',
      DisplayName: 'Key',
    });

    const pk = store.getPasskeyById('pk1');
    expect(pk).not.toBeNull();
    expect(pk!.ServiceName).toBe('GitHub');
  });

  it('deletePasskeyById soft-deletes', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);
    await store.createPasskey({
      Id: 'pk1',
      CredentialId: credId,
      RpId: 'github.com',
      PublicKey: 'pub',
      PrivateKey: 'priv',
      DisplayName: 'Key',
    });

    const result = await store.deletePasskeyById('pk1');
    expect(result).toBe(1);
    expect(store.getPasskeysByRpId('github.com')).toHaveLength(0);
  });

  it('deletePasskeysByCredentialId soft-deletes all passkeys', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);
    await store.createPasskey({ Id: 'pk1', CredentialId: credId, RpId: 'a.com', PublicKey: 'p', PrivateKey: 'p', DisplayName: 'K1' });
    await store.createPasskey({ Id: 'pk2', CredentialId: credId, RpId: 'b.com', PublicKey: 'p', PrivateKey: 'p', DisplayName: 'K2' });

    const count = await store.deletePasskeysByCredentialId(credId);
    expect(count).toBe(2);
    expect(store.getPasskeysByCredentialId(credId)).toHaveLength(0);
  });

  it('updatePasskeyDisplayName updates name', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);
    await store.createPasskey({
      Id: 'pk1',
      CredentialId: credId,
      RpId: 'github.com',
      PublicKey: 'pub',
      PrivateKey: 'priv',
      DisplayName: 'Old Name',
    });

    await store.updatePasskeyDisplayName('pk1', 'New Name');
    const pk = store.getPasskeyById('pk1');
    expect(pk!.DisplayName).toBe('New Name');
  });

  it('credential HasPasskey flag set correctly', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);
    expect(store.getCredentialById(credId)!.HasPasskey).toBe(false);

    await store.createPasskey({
      Id: 'pk1',
      CredentialId: credId,
      RpId: 'github.com',
      PublicKey: 'pub',
      PrivateKey: 'priv',
      DisplayName: 'Key',
    });
    expect(store.getCredentialById(credId)!.HasPasskey).toBe(true);
  });

  it('UserHandle and PrfKey binary round-trip through base64', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);
    const userHandle = new Uint8Array([1, 2, 3, 4]);
    const prfKey = new Uint8Array([10, 20, 30]);

    await store.createPasskey({
      Id: 'pk1',
      CredentialId: credId,
      RpId: 'test.com',
      UserHandle: userHandle,
      PublicKey: 'pub',
      PrivateKey: 'priv',
      PrfKey: prfKey,
      DisplayName: 'Key',
    });

    // Roundtrip through JSON
    const json = store.toJson();
    const restored = VaultStore.fromJson(json);
    const pk = restored.getPasskeysByCredentialId(credId)[0];
    expect(Array.from(pk.UserHandle as Uint8Array)).toEqual([1, 2, 3, 4]);
    expect(Array.from(pk.PrfKey as Uint8Array)).toEqual([10, 20, 30]);
  });
});

// --- 3.3 Settings ---
describe('Settings', () => {
  it('getSetting returns default when key not found', () => {
    const store = VaultStore.createEmpty();
    expect(store.getSetting('missing')).toBe('');
    expect(store.getSetting('missing', 'fallback')).toBe('fallback');
  });

  it('setSetting and getSetting round-trip', () => {
    const store = VaultStore.createEmpty();
    store.setSetting('theme', 'dark');
    expect(store.getSetting('theme')).toBe('dark');
  });

  it('midnightSecretKey round-trip', () => {
    const store = VaultStore.createEmpty();
    store.setSetting('midnightSecretKey', '0xdeadbeef');
    expect(store.getSetting('midnightSecretKey')).toBe('0xdeadbeef');

    const json = store.toJson();
    const restored = VaultStore.fromJson(json);
    expect(restored.getSetting('midnightSecretKey')).toBe('0xdeadbeef');
  });

  it('getDefaultEmailDomain returns setting or null', async () => {
    const store = VaultStore.createEmpty();
    expect(await store.getDefaultEmailDomain()).toBeNull();
    store.setSetting('DefaultEmailDomain', 'example.com');
    expect(await store.getDefaultEmailDomain()).toBe('example.com');
  });

  it('getPasswordSettings returns defaults when not set', () => {
    const store = VaultStore.createEmpty();
    const settings = store.getPasswordSettings();
    expect(settings.Length).toBe(18);
    expect(settings.UseLowercase).toBe(true);
  });

  it('getPasswordSettings parses stored JSON', () => {
    const store = VaultStore.createEmpty();
    store.setSetting('PasswordGenerationSettings', JSON.stringify({ Length: 24, UseSpecialChars: false }));
    const settings = store.getPasswordSettings();
    expect(settings.Length).toBe(24);
    expect(settings.UseSpecialChars).toBe(false);
    expect(settings.UseLowercase).toBe(true); // default preserved
  });

  it('getEffectiveIdentityLanguage returns stored or "en"', async () => {
    const store = VaultStore.createEmpty();
    expect(await store.getEffectiveIdentityLanguage()).toBe('en');
    store.setSetting('DefaultIdentityLanguage', 'nl');
    expect(await store.getEffectiveIdentityLanguage()).toBe('nl');
  });

  it('getDefaultIdentityGender returns stored or "random"', () => {
    const store = VaultStore.createEmpty();
    expect(store.getDefaultIdentityGender()).toBe('random');
    store.setSetting('DefaultIdentityGender', 'female');
    expect(store.getDefaultIdentityGender()).toBe('female');
  });
});

// --- 3.4 Encryption keys ---
describe('Encryption keys', () => {
  it('addEncryptionKey and getAllEncryptionKeys', () => {
    const store = VaultStore.createEmpty();
    const key: EncryptionKey = { Id: 'ek1', PublicKey: 'pub', PrivateKey: 'priv', IsPrimary: true };
    store.addEncryptionKey(key);

    const keys = store.getAllEncryptionKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].PublicKey).toBe('pub');
    expect(keys[0].IsPrimary).toBe(true);
  });

  it('deduplication by id', () => {
    const store = VaultStore.createEmpty();
    const key: EncryptionKey = { Id: 'ek1', PublicKey: 'pub', PrivateKey: 'priv', IsPrimary: true };
    store.addEncryptionKey(key);
    store.addEncryptionKey(key);
    expect(store.getAllEncryptionKeys()).toHaveLength(1);
  });
});

// --- 3.5 Soft-delete ---
describe('Soft-delete behavior', () => {
  it('deleteCredentialById sets isDeleted, getAllCredentials filters', async () => {
    const store = VaultStore.createEmpty();
    const id = await store.createCredential(makeCredential(), []);
    await store.deleteCredentialById(id);
    expect(store.getAllCredentials()).toHaveLength(0);

    // Verify internal state has isDeleted=true (via roundtrip)
    const json = store.toJson();
    const parsed = JSON.parse(json);
    expect(parsed.credentials[id].isDeleted).toBe(true);
  });

  it('deleting credential also soft-deletes its passkeys', async () => {
    const store = VaultStore.createEmpty();
    const credId = await store.createCredential(makeCredential(), []);
    await store.createPasskey({
      Id: 'pk1',
      CredentialId: credId,
      RpId: 'test.com',
      PublicKey: 'pub',
      PrivateKey: 'priv',
      DisplayName: 'Key',
    });

    await store.deleteCredentialById(credId);
    expect(store.getPasskeysByRpId('test.com')).toHaveLength(0);
  });
});

// --- 3.6 Edge cases ---
describe('Edge cases', () => {
  it('empty vault: getAllCredentials returns []', () => {
    const store = VaultStore.createEmpty();
    expect(store.getAllCredentials()).toEqual([]);
  });

  it('fromJson with missing fields initializes defaults', () => {
    const minimal = JSON.stringify({ version: 1 });
    const store = VaultStore.fromJson(minimal);
    expect(store.getAllCredentials()).toEqual([]);
    expect(store.getAllEncryptionKeys()).toEqual([]);
    expect(store.getSetting('anything')).toBe('');
  });

  it('fromJson with malformed input throws', () => {
    expect(() => VaultStore.fromJson('not json')).toThrow();
    expect(() => VaultStore.fromJson('')).toThrow();
  });

  it('deleteCredentialById with non-existent id returns 0', async () => {
    const store = VaultStore.createEmpty();
    expect(await store.deleteCredentialById('nope')).toBe(0);
  });

  it('updateCredentialById with non-existent id throws', async () => {
    const store = VaultStore.createEmpty();
    await expect(
      store.updateCredentialById(makeCredential({ Id: 'nope' }), [], [])
    ).rejects.toThrow('Credential not found');
  });

  it('getAllEmailAddresses returns unique emails', async () => {
    const store = VaultStore.createEmpty();
    await store.createCredential(makeCredential({ Alias: { ...makeCredential().Alias, Email: 'a@test.com' } }), []);
    await store.createCredential(makeCredential({ Alias: { ...makeCredential().Alias, Email: 'a@test.com' } }), []);
    await store.createCredential(makeCredential({ Alias: { ...makeCredential().Alias, Email: 'b@test.com' } }), []);
    expect(store.getAllEmailAddresses()).toHaveLength(2);
  });
});

// --- 3.7 Version validation ---
describe('Version validation', () => {
  it('fromJson with version > CURRENT_VERSION throws descriptive error', () => {
    const future = JSON.stringify({ version: 999, credentials: {}, settings: {}, encryptionKeys: [] });
    expect(() => VaultStore.fromJson(future)).toThrow('Vault version 999 is not supported');
    expect(() => VaultStore.fromJson(future)).toThrow('Maximum supported version: 1');
  });

  it('fromJson with version === CURRENT_VERSION succeeds', () => {
    const valid = JSON.stringify({ version: 1, credentials: {}, settings: {}, encryptionKeys: [] });
    const store = VaultStore.fromJson(valid);
    expect(store.getDatabaseVersion()).toBe(1);
  });

  it('fromJson with missing version defaults to 1', () => {
    const noVersion = JSON.stringify({ credentials: {}, settings: {}, encryptionKeys: [] });
    const store = VaultStore.fromJson(noVersion);
    expect(store.getDatabaseVersion()).toBe(1);
  });

  it('getDatabaseVersion returns vault version', () => {
    const store = VaultStore.createEmpty();
    expect(store.getDatabaseVersion()).toBe(1);
  });

  it('hasPendingMigrations always returns false', async () => {
    const store = VaultStore.createEmpty();
    expect(await store.hasPendingMigrations()).toBe(false);
  });
});

// --- 3.8 Logo roundtrip ---
describe('Logo roundtrip', () => {
  it('create credential with binary Logo, read back via getAllCredentials, verify bytes match', async () => {
    const store = VaultStore.createEmpty();
    const logoBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG header

    const id = await store.createCredential(
      makeCredential({ Logo: logoBytes }),
      []
    );

    // Read back
    const cred = store.getAllCredentials().find(c => c.Id === id);
    expect(cred).toBeTruthy();
    expect(cred!.Logo).toBeInstanceOf(Uint8Array);
    expect(Array.from(cred!.Logo as Uint8Array)).toEqual(Array.from(logoBytes));
  });

  it('logo survives JSON serialization roundtrip', async () => {
    const store = VaultStore.createEmpty();
    const logoBytes = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);

    const id = await store.createCredential(makeCredential({ Logo: logoBytes }), []);
    const json = store.toJson();
    const restored = VaultStore.fromJson(json);

    const cred = restored.getCredentialById(id);
    expect(Array.from(cred!.Logo as Uint8Array)).toEqual(Array.from(logoBytes));
  });

  it('credential without Logo returns undefined Logo', async () => {
    const store = VaultStore.createEmpty();
    const id = await store.createCredential(makeCredential({ Logo: undefined }), []);
    const cred = store.getCredentialById(id);
    expect(cred!.Logo).toBeUndefined();
  });

  it('Logo stored as base64 string in JSON', async () => {
    const store = VaultStore.createEmpty();
    const logoBytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const id = await store.createCredential(makeCredential({ Logo: logoBytes }), []);

    const parsed = JSON.parse(store.toJson());
    const tree = parsed.credentials[id];
    expect(typeof tree.logo).toBe('string');
    expect(tree.logo).toBe(btoa('Hello'));
  });
});
