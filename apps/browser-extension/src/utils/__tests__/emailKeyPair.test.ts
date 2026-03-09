import { describe, it, expect } from 'vitest';
import {
  generateEmailKeyPair,
  getEmailKeyPairFromSettings,
  storeEmailKeyPairInSettings,
} from '../emailKeyPair';
import { bytesToHex } from '../hex';

describe('generateEmailKeyPair', () => {
  it('generates a valid X25519 keypair', () => {
    const keyPair = generateEmailKeyPair();

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.secretKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(32);
    expect(keyPair.secretKey.length).toBe(32);
  });

  it('generates unique keypairs on each call', () => {
    const kp1 = generateEmailKeyPair();
    const kp2 = generateEmailKeyPair();

    expect(Buffer.from(kp1.publicKey)).not.toEqual(Buffer.from(kp2.publicKey));
    expect(Buffer.from(kp1.secretKey)).not.toEqual(Buffer.from(kp2.secretKey));
  });
});

describe('getEmailKeyPairFromSettings', () => {
  it('returns null when keys not present', () => {
    expect(getEmailKeyPairFromSettings({})).toBeNull();
  });

  it('returns null when only public key present', () => {
    const settings = { emailPublicKey: 'aa'.repeat(32) };
    expect(getEmailKeyPairFromSettings(settings)).toBeNull();
  });

  it('returns null when only private key present', () => {
    const settings = { emailPrivateKey: 'bb'.repeat(32) };
    expect(getEmailKeyPairFromSettings(settings)).toBeNull();
  });

  it('returns null for invalid hex', () => {
    const settings = {
      emailPublicKey: 'not-valid-hex',
      emailPrivateKey: 'also-invalid',
    };
    expect(getEmailKeyPairFromSettings(settings)).toBeNull();
  });

  it('returns null for wrong length hex', () => {
    const settings = {
      emailPublicKey: 'aabb', // too short
      emailPrivateKey: 'ccdd',
    };
    expect(getEmailKeyPairFromSettings(settings)).toBeNull();
  });

  it('returns keypair for valid hex settings', () => {
    const keyPair = generateEmailKeyPair();
    const settings: Record<string, string> = {};
    storeEmailKeyPairInSettings(settings, keyPair);

    const retrieved = getEmailKeyPairFromSettings(settings);

    expect(retrieved).not.toBeNull();
    expect(Buffer.from(retrieved!.publicKey)).toEqual(Buffer.from(keyPair.publicKey));
    expect(Buffer.from(retrieved!.secretKey)).toEqual(Buffer.from(keyPair.secretKey));
  });
});

describe('storeEmailKeyPairInSettings', () => {
  it('stores keypair as hex strings in settings', () => {
    const keyPair = generateEmailKeyPair();
    const settings: Record<string, string> = {};

    storeEmailKeyPairInSettings(settings, keyPair);

    expect(settings.emailPublicKey).toBe(bytesToHex(keyPair.publicKey));
    expect(settings.emailPrivateKey).toBe(bytesToHex(keyPair.secretKey));
    expect(settings.emailPublicKey.length).toBe(64);
    expect(settings.emailPrivateKey.length).toBe(64);
  });

  it('roundtrips correctly', () => {
    const original = generateEmailKeyPair();
    const settings: Record<string, string> = {};

    storeEmailKeyPairInSettings(settings, original);
    const retrieved = getEmailKeyPairFromSettings(settings);

    expect(retrieved).not.toBeNull();
    expect(Buffer.from(retrieved!.publicKey)).toEqual(Buffer.from(original.publicKey));
    expect(Buffer.from(retrieved!.secretKey)).toEqual(Buffer.from(original.secretKey));
  });
});
