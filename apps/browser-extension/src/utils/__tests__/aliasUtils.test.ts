import { describe, it, expect } from 'vitest';
import { validateAliasName, generateRandomAlias, hashAlias, ALIAS_DOMAIN } from '../aliasUtils';

describe('validateAliasName', () => {
  it('accepts valid alias names', () => {
    expect(validateAliasName('abc').valid).toBe(true);
    expect(validateAliasName('zk-tiger-7842').valid).toBe(true);
    expect(validateAliasName('a1b').valid).toBe(true);
    expect(validateAliasName('test-alias').valid).toBe(true);
    expect(validateAliasName('x'.repeat(64)).valid).toBe(true);
  });

  it('rejects too short', () => {
    const result = validateAliasName('ab');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least 3');
  });

  it('rejects empty string', () => {
    expect(validateAliasName('').valid).toBe(false);
  });

  it('rejects too long', () => {
    const result = validateAliasName('x'.repeat(65));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at most 64');
  });

  it('rejects uppercase', () => {
    const result = validateAliasName('Hello');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('lowercase');
  });

  it('rejects leading hyphen', () => {
    const result = validateAliasName('-abc');
    expect(result.valid).toBe(false);
  });

  it('rejects trailing hyphen', () => {
    const result = validateAliasName('abc-');
    expect(result.valid).toBe(false);
  });

  it('rejects consecutive hyphens', () => {
    const result = validateAliasName('abc--def');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('consecutive hyphens');
  });

  it('rejects special characters', () => {
    expect(validateAliasName('abc_def').valid).toBe(false);
    expect(validateAliasName('abc.def').valid).toBe(false);
    expect(validateAliasName('abc@def').valid).toBe(false);
    expect(validateAliasName('abc def').valid).toBe(false);
  });

  it('rejects single char', () => {
    expect(validateAliasName('a').valid).toBe(false);
  });
});

describe('generateRandomAlias', () => {
  it('generates a valid alias', () => {
    const alias = generateRandomAlias();
    expect(validateAliasName(alias).valid).toBe(true);
  });

  it('matches adjective-noun-digits pattern', () => {
    const alias = generateRandomAlias();
    const parts = alias.split('-');
    expect(parts.length).toBe(3);
    expect(parts[2]).toMatch(/^\d{4}$/);
  });

  it('generates different aliases', () => {
    const aliases = new Set<string>();
    for (let i = 0; i < 20; i++) {
      aliases.add(generateRandomAlias());
    }
    // With 16 adjectives * 16 nouns * 10000 digits, collisions are very unlikely
    expect(aliases.size).toBeGreaterThan(10);
  });
});

describe('hashAlias', () => {
  it('returns 32-byte Uint8Array', async () => {
    const hash = await hashAlias('test');
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it('uses alias.id as default domain', async () => {
    const hash1 = await hashAlias('test');
    const hash2 = await hashAlias('test', ALIAS_DOMAIN);
    expect(Buffer.from(hash1)).toEqual(Buffer.from(hash2));
  });

  it('produces consistent hashes', async () => {
    const hash1 = await hashAlias('zk-tiger-7842');
    const hash2 = await hashAlias('zk-tiger-7842');
    expect(Buffer.from(hash1)).toEqual(Buffer.from(hash2));
  });

  it('produces different hashes for different aliases', async () => {
    const hash1 = await hashAlias('alias-one');
    const hash2 = await hashAlias('alias-two');
    expect(Buffer.from(hash1)).not.toEqual(Buffer.from(hash2));
  });

  it('produces different hashes for different domains', async () => {
    const hash1 = await hashAlias('test', 'alias.id');
    const hash2 = await hashAlias('test', 'other.domain');
    expect(Buffer.from(hash1)).not.toEqual(Buffer.from(hash2));
  });
});
