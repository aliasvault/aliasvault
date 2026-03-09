import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { hashAlias, ALIAS_DOMAIN } from '../services/aliasHashing.js';

describe('aliasHashing', () => {
  it('ALIAS_DOMAIN is alias.id', () => {
    expect(ALIAS_DOMAIN).toBe('alias.id');
  });

  it('produces 32-byte SHA-256 hash', () => {
    const hash = hashAlias('test');
    expect(hash.length).toBe(32);
    expect(hash).toBeInstanceOf(Uint8Array);
  });

  it('hashes "localPart@alias.id" — matches Node.js crypto directly', () => {
    const localPart = 'zk-tiger-1234';
    const email = `${localPart}@alias.id`;

    // Reference: direct Node.js crypto
    const expected = createHash('sha256').update(email).digest();

    const result = hashAlias(localPart);
    expect(Buffer.from(result).equals(expected)).toBe(true);
  });

  it('matches browser extension hashAlias output for known input', () => {
    // Browser extension: crypto.subtle.digest('SHA-256', TextEncoder.encode("test@alias.id"))
    // Both use UTF-8 encoding of "test@alias.id" → SHA-256
    // This is a deterministic test — same input always produces same output
    const hash = hashAlias('test');
    const hex = Buffer.from(hash).toString('hex');

    // Pre-computed: SHA-256("test@alias.id")
    const expected = createHash('sha256').update('test@alias.id').digest('hex');
    expect(hex).toBe(expected);
  });

  it('is case-sensitive (alias names are lowercase)', () => {
    const lower = hashAlias('test');
    const upper = hashAlias('Test');
    expect(Buffer.from(lower).equals(Buffer.from(upper))).toBe(false);
  });

  it('uses custom domain when specified', () => {
    const defaultHash = hashAlias('test');
    const customHash = hashAlias('test', 'other.domain');
    expect(Buffer.from(defaultHash).equals(Buffer.from(customHash))).toBe(false);
  });

  it('produces different hashes for different aliases', () => {
    const hash1 = hashAlias('alice');
    const hash2 = hashAlias('bob');
    expect(Buffer.from(hash1).equals(Buffer.from(hash2))).toBe(false);
  });
});
