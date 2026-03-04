import { describe, it, expect } from 'vitest';
import { resolveVaultConflict } from '../mergeVault';
import { VaultStore } from '../VaultStore';
import type { VaultJson, CredentialTree, EncryptionKeyEntry } from '../types';

// --- Test Helpers ---

function makeVault(overrides: Partial<VaultJson> = {}): VaultJson {
  return {
    version: 1,
    credentials: {},
    settings: {},
    encryptionKeys: [],
    lastModified: Date.now(),
    ...overrides,
  };
}

function makeTree(
  id: string,
  updatedAt: number,
  overrides: Partial<CredentialTree> = {},
): CredentialTree {
  return {
    id,
    serviceName: 'Test Service',
    username: 'testuser',
    password: { value: 'pass', createdAt: updatedAt, updatedAt },
    notes: '',
    alias: { birthDate: '1990-01-01' },
    attachments: [],
    totpCodes: [],
    passkeys: [],
    createdAt: updatedAt,
    updatedAt,
    isDeleted: false,
    ...overrides,
  };
}

function makeKey(id: string, overrides: Partial<EncryptionKeyEntry> = {}): EncryptionKeyEntry {
  return {
    id,
    publicKey: `pub-${id}`,
    privateKey: `priv-${id}`,
    isPrimary: false,
    ...overrides,
  };
}

// --- Task 3: Credential merge scenarios (AC 2-6, 11) ---

describe('resolveVaultConflict — credential merge', () => {
  it('3.2: remote-only credential → added', () => {
    const local = makeVault();
    const remote = makeVault({
      credentials: { r1: makeTree('r1', 100) },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['r1']).toEqual(remote.credentials['r1']);
    expect(summary.added).toContain('r1');
  });

  it('3.3: local-only credential → kept', () => {
    const local = makeVault({
      credentials: { l1: makeTree('l1', 100) },
    });
    const remote = makeVault();

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['l1']).toEqual(local.credentials['l1']);
    expect(summary.kept).toContain('l1');
  });

  it('3.4: both exist, remote updatedAt newer → remote wins, summary.updated', () => {
    const local = makeVault({
      credentials: { c1: makeTree('c1', 100) },
    });
    const remote = makeVault({
      credentials: { c1: makeTree('c1', 200, { serviceName: 'Updated' }) },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['c1'].serviceName).toBe('Updated');
    expect(merged.credentials['c1'].updatedAt).toBe(200);
    expect(summary.updated).toContain('c1');
  });

  it('3.5: both exist, local updatedAt newer → local wins, summary.kept', () => {
    const local = makeVault({
      credentials: { c1: makeTree('c1', 300, { serviceName: 'LocalEdit' }) },
    });
    const remote = makeVault({
      credentials: { c1: makeTree('c1', 100) },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['c1'].serviceName).toBe('LocalEdit');
    expect(summary.kept).toContain('c1');
  });

  it('3.6: both exist, same updatedAt → local wins (tie-break), summary.kept', () => {
    const local = makeVault({
      credentials: { c1: makeTree('c1', 100, { serviceName: 'Local' }) },
    });
    const remote = makeVault({
      credentials: { c1: makeTree('c1', 100, { serviceName: 'Remote' }) },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['c1'].serviceName).toBe('Local');
    expect(summary.kept).toContain('c1');
  });

  it('3.7: deletion conflict — local deleted, remote modified later → remote wins (not deleted)', () => {
    const local = makeVault({
      credentials: { c1: makeTree('c1', 100, { isDeleted: true }) },
    });
    const remote = makeVault({
      credentials: { c1: makeTree('c1', 200, { isDeleted: false }) },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['c1'].isDeleted).toBe(false);
    expect(merged.credentials['c1'].updatedAt).toBe(200);
    expect(summary.updated).toContain('c1');
  });

  it('3.8: deletion conflict — remote deleted, local modified later → local wins (not deleted)', () => {
    const local = makeVault({
      credentials: { c1: makeTree('c1', 200, { isDeleted: false }) },
    });
    const remote = makeVault({
      credentials: { c1: makeTree('c1', 100, { isDeleted: true }) },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['c1'].isDeleted).toBe(false);
    expect(merged.credentials['c1'].updatedAt).toBe(200);
    expect(summary.kept).toContain('c1');
  });

  it('3.9: both deleted → merged is deleted, summary.deleted', () => {
    const local = makeVault({
      credentials: { c1: makeTree('c1', 100, { isDeleted: true }) },
    });
    const remote = makeVault({
      credentials: { c1: makeTree('c1', 100, { isDeleted: true }) },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['c1'].isDeleted).toBe(true);
    expect(summary.deleted).toContain('c1');
  });

  it('3.10: simultaneous new credentials (different UUIDs, same service+username) → both kept', () => {
    const local = makeVault({
      credentials: { a1: makeTree('a1', 100, { serviceName: 'GitHub', username: 'user' }) },
    });
    const remote = makeVault({
      credentials: { b1: makeTree('b1', 100, { serviceName: 'GitHub', username: 'user' }) },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['a1']).toBeDefined();
    expect(merged.credentials['b1']).toBeDefined();
    expect(summary.kept).toContain('a1');
    expect(summary.added).toContain('b1');
  });

  it('3.11: empty local + populated remote → all remote credentials added', () => {
    const local = makeVault();
    const remote = makeVault({
      credentials: {
        r1: makeTree('r1', 100),
        r2: makeTree('r2', 200),
      },
    });

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(Object.keys(merged.credentials)).toHaveLength(2);
    expect(summary.added).toEqual(expect.arrayContaining(['r1', 'r2']));
  });

  it('3.12: populated local + empty remote → all local credentials kept', () => {
    const local = makeVault({
      credentials: {
        l1: makeTree('l1', 100),
        l2: makeTree('l2', 200),
      },
    });
    const remote = makeVault();

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(Object.keys(merged.credentials)).toHaveLength(2);
    expect(summary.kept).toEqual(expect.arrayContaining(['l1', 'l2']));
  });

  it('3.13b: local-only deleted credential → summary.kept (not summary.deleted)', () => {
    const local = makeVault({
      credentials: { c1: makeTree('c1', 100, { isDeleted: true }) },
    });
    const remote = makeVault();

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(merged.credentials['c1'].isDeleted).toBe(true);
    expect(summary.kept).toContain('c1');
    expect(summary.deleted).not.toContain('c1');
  });

  it('3.13: both empty → merged is empty, all summary arrays empty', () => {
    const local = makeVault();
    const remote = makeVault();

    const { merged, summary } = resolveVaultConflict(local, remote);

    expect(Object.keys(merged.credentials)).toHaveLength(0);
    expect(summary.added).toHaveLength(0);
    expect(summary.updated).toHaveLength(0);
    expect(summary.deleted).toHaveLength(0);
    expect(summary.kept).toHaveLength(0);
  });
});

// --- Task 4: Settings and encryption keys merge (AC 7, 8, 11) ---

describe('resolveVaultConflict — settings merge', () => {
  it('4.1: disjoint settings → merged union', () => {
    const local = makeVault({ settings: { a: '1' } });
    const remote = makeVault({ settings: { b: '2' } });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.settings).toEqual({ a: '1', b: '2' });
  });

  it('4.2: same key, different values → remote wins', () => {
    const local = makeVault({ settings: { theme: 'dark' } });
    const remote = makeVault({ settings: { theme: 'light' } });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.settings.theme).toBe('light');
  });

  it('4.3: midnightSecretKey preserved when remote lacks it', () => {
    const local = makeVault({ settings: { midnightSecretKey: 'secret123' } });
    const remote = makeVault({ settings: { other: 'value' } });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.settings.midnightSecretKey).toBe('secret123');
  });

  it('4.3b: midnightSecretKey overwritten when remote has different value (AC 7: remote wins per key)', () => {
    // AC 7 specifies "remote wins per key" — this applies to ALL settings keys
    // including midnightSecretKey. The caller (Story 4.3 sync service) is
    // responsible for protecting keys that should never be overwritten.
    const local = makeVault({ settings: { midnightSecretKey: 'localSecret' } });
    const remote = makeVault({ settings: { midnightSecretKey: 'remoteSecret' } });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.settings.midnightSecretKey).toBe('remoteSecret');
  });
});

describe('resolveVaultConflict — encryption keys merge', () => {
  it('4.4: disjoint keys → union', () => {
    const local = makeVault({ encryptionKeys: [makeKey('ek1')] });
    const remote = makeVault({ encryptionKeys: [makeKey('ek2')] });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.encryptionKeys).toHaveLength(2);
    expect(merged.encryptionKeys.map((k) => k.id)).toEqual(expect.arrayContaining(['ek1', 'ek2']));
  });

  it('4.5: duplicate id → deduplicated, remote wins', () => {
    const local = makeVault({ encryptionKeys: [makeKey('ek1', { publicKey: 'localPub' })] });
    const remote = makeVault({ encryptionKeys: [makeKey('ek1', { publicKey: 'remotePub' })] });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.encryptionKeys).toHaveLength(1);
    expect(merged.encryptionKeys[0].id).toBe('ek1');
    expect(merged.encryptionKeys[0].publicKey).toBe('remotePub');
  });

  it('4.6: empty on one side → other side kept', () => {
    const local = makeVault({ encryptionKeys: [] });
    const remote = makeVault({ encryptionKeys: [makeKey('ek1'), makeKey('ek2')] });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.encryptionKeys).toHaveLength(2);
  });
});

// --- Task 5: Merged vault envelope (AC 9) ---

describe('resolveVaultConflict — vault envelope', () => {
  it('5.1: merged version = Math.max(local.version, remote.version)', () => {
    const local = makeVault({ version: 3 });
    const remote = makeVault({ version: 5 });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.version).toBe(5);
  });

  it('5.1b: version when local is higher', () => {
    const local = makeVault({ version: 7 });
    const remote = makeVault({ version: 2 });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.version).toBe(7);
  });

  it('5.2: merged lastModified is recent Unix timestamp', () => {
    const before = Date.now();
    const local = makeVault({ version: 1, lastModified: 1000 });
    const remote = makeVault({ version: 1, lastModified: 2000 });

    const { merged } = resolveVaultConflict(local, remote);

    expect(merged.lastModified).toBeGreaterThanOrEqual(before);
    expect(merged.lastModified).toBeLessThanOrEqual(Date.now());
  });

  it('5.3: merged vault round-trips through JSON and VaultStore.fromJson()', () => {
    const local = makeVault({
      version: 1,
      credentials: { c1: makeTree('c1', 100) },
      settings: { key: 'val' },
      encryptionKeys: [makeKey('ek1')],
    });
    const remote = makeVault({
      version: 1,
      credentials: { c2: makeTree('c2', 200) },
      settings: { key2: 'val2' },
      encryptionKeys: [makeKey('ek2')],
    });

    const { merged } = resolveVaultConflict(local, remote);

    // VaultStore.fromJson() accepts a JSON string and validates structure
    const json = JSON.stringify(merged);
    const store = VaultStore.fromJson(json);

    // VaultStore.toJson() returns a string — parse it to verify round-trip
    const roundTripped = JSON.parse(store.toJson()) as VaultJson;

    expect(roundTripped.version).toBe(1);
    expect(Object.keys(roundTripped.credentials)).toHaveLength(2);
    expect(roundTripped.credentials['c1']).toBeDefined();
    expect(roundTripped.credentials['c2']).toBeDefined();
    expect(roundTripped.settings).toHaveProperty('key');
    expect(roundTripped.settings).toHaveProperty('key2');
    expect(roundTripped.encryptionKeys).toHaveLength(2);
    expect(typeof roundTripped.lastModified).toBe('number');
  });
});
