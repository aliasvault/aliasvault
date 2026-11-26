import { createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, webcrypto, type JsonWebKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FieldKey } from '@aliasvault/models/vault';

import { convertToItem } from '../writers/ItemConverter';

import type { JwkPair } from '../../../rust/RustCoreTypes';
import type { ItemEntity } from '../../shared/VaultEntities';
import type { ImportedCredential } from '../models/ImportedCredential';
import type { ImportedPasskey } from '../models/ImportedPasskey';
import type { PasskeyKeyConverter } from '../readers/PasskeyImport';

/*
 * Fixture readers and lookups for the import tests; fixtures live next to the test that reads them.
 */

/**
 * Read a fixture as text.
 * @param dir - The directory holding the fixture, usually the test's own `import.meta.dirname`
 * @param name - The file name
 * @returns The file content
 */
export function readFixtureText(dir: string, name: string): string {
  return readFileSync(path.join(dir, name), 'utf8');
}

/**
 * Read a fixture as bytes.
 * @param dir - The directory holding the fixture, usually the test's own `import.meta.dirname`
 * @param name - The file name
 * @returns The file bytes
 */
export function readFixtureBytes(dir: string, name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(dir, name)));
}

/**
 * The first credential with a given service name.
 * @param credentials - The credentials
 * @param serviceName - The service name
 * @returns The credential
 */
export function byName(credentials: ImportedCredential[], serviceName: string): ImportedCredential {
  const credential = credentials.find(c => c.ServiceName === serviceName);
  if (!credential) {
    throw new Error(`No credential named '${serviceName}'`);
  }
  return credential;
}

/**
 * The first item with a given name.
 * @param items - The items
 * @param name - The item name
 * @returns The item
 */
export function itemByName(items: ItemEntity[], name: string): ItemEntity {
  const item = items.find(i => i.Name === name);
  if (!item) {
    throw new Error(`No item named '${name}'`);
  }
  return item;
}

/**
 * The first item with a given username, for items that share a name.
 * @param items - The items
 * @param username - The username
 * @returns The item
 */
export function itemByUsername(items: ItemEntity[], username: string): ItemEntity {
  const item = items.find(i => i.FieldValues.some(field => field.FieldKey === FieldKey.LoginUsername && field.Value === username));
  if (!item) {
    throw new Error(`No item with username '${username}'`);
  }
  return item;
}

/**
 * Convert imported credentials to vault items, the way the import writer does one by one.
 * @param credentials - The imported credentials
 * @param folderPathToId - Folder paths to folder ids, or null
 * @returns The items
 */
export function convertToItems(credentials: ImportedCredential[], folderPathToId: Map<string, string> | null = null): ItemEntity[] {
  return credentials.map(credential => convertToItem(credential, folderPathToId));
}

/**
 * A UTC date.
 * @param year - Year
 * @param month - 1-based month
 * @param day - Day
 * @returns The date
 */
export function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;

/** The PKCS#8 DER prefix of an Ed25519 private key (RFC 8410), followed by its 32-byte seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * A P-256 key as the JWK pair the vault stores.
 * @param jwk - The private JWK
 * @returns The pair
 */
function toJwkPair(jwk: { x?: string; y?: string; d?: string }): JwkPair {
  const publicKey = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  return { publicKeyJwk: JSON.stringify(publicKey), privateKeyJwk: JSON.stringify({ ...publicKey, d: jwk.d }) };
}

/**
 * Converts P-256 and Ed25519 passkey keys with Node's crypto, standing in for the Rust core (whose conversion is
 * tested in core/rust/src/passkey/tests/keys.rs) so the import tests do not depend on the wasm build.
 */
export const testPasskeyKeys: PasskeyKeyConverter = {
  /**
   * From a PKCS#8 DER private key (P-256 or Ed25519).
   * @param pkcs8Der - The key
   * @returns The pair
   */
  fromPkcs8: async (pkcs8Der) => {
    const jwk = createPrivateKey({ key: Buffer.from(pkcs8Der), format: 'der', type: 'pkcs8' }).export({ format: 'jwk' });
    if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
      return toEd25519JwkPair(jwk);
    }
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
      throw new Error(`Unsupported test key ${jwk.kty} ${jwk.crv}`);
    }
    return toJwkPair(jwk);
  },
  /**
   * From a raw private scalar.
   * @param scalar - The scalar
   * @returns The pair
   */
  fromP256Scalar: async (scalar) => {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(scalar);
    const point = ecdh.getPublicKey();
    return toJwkPair({ x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url'), d: Buffer.from(scalar).toString('base64url') });
  },
  /**
   * From a raw Ed25519 seed.
   * @param seed - The seed
   * @returns The pair
   */
  fromEd25519Seed: async (seed) => toEd25519JwkPair(createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' }).export({ format: 'jwk' })),
};

/**
 * An Ed25519 key as the JWK pair the vault stores.
 * @param jwk - The private JWK
 * @returns The pair
 */
function toEd25519JwkPair(jwk: { x?: string; d?: string }): JwkPair {
  const publicKey = { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
  return { publicKeyJwk: JSON.stringify(publicKey), privateKeyJwk: JSON.stringify({ ...publicKey, d: jwk.d }) };
}

/**
 * A new Ed25519 private key as its 32-byte seed, the form Proton Pass stores it in.
 * @returns The seed
 */
export function generateEd25519Seed(): Uint8Array {
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  return new Uint8Array(Buffer.from(jwk.d!, 'base64url'));
}

/**
 * A new P-256 private key in both forms other providers export it in.
 * @returns The PKCS#8 DER bytes and the raw scalar
 */
export async function generatePasskeyKey(): Promise<{ pkcs8: Uint8Array; scalar: Uint8Array }> {
  const pair = await webcrypto.subtle.generateKey(P256, true, ['sign']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  return { pkcs8: new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)), scalar: new Uint8Array(Buffer.from(jwk.d!, 'base64url')) };
}

/**
 * Whether the private key of an imported passkey signs a challenge its public key verifies.
 * @param passkey - The passkey
 * @returns True when the key pair works
 */
export function passkeyCanSign(passkey: ImportedPasskey): boolean {
  const privateKey = createPrivateKey({ key: JSON.parse(passkey.PrivateKey) as JsonWebKey, format: 'jwk' });
  const publicKey = createPublicKey({ key: JSON.parse(passkey.PublicKey) as JsonWebKey, format: 'jwk' });
  const challenge = Buffer.from('aliasvault-challenge');
  // Ed25519 hashes internally and takes no digest.
  const digest = privateKey.asymmetricKeyType === 'ed25519' ? null : 'sha256';
  return verify(digest, challenge, publicKey, sign(digest, challenge, privateKey));
}

/**
 * The custom fields of a credential as `[label, value, field type]`.
 * @param credential - The credential
 * @returns The fields
 */
export function customFieldsOf(credential: ImportedCredential): (string | null | undefined)[][] {
  return (credential.CustomFieldValues ?? []).map(field => [field.Label, field.Value, field.FieldType]);
}
